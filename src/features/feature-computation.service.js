import pool from '../db/client.js';
import registry from './feature-registry.json' with { type: 'json' };
import { FeatureValidator } from './feature-validator.js';

const FEATURES = registry.features;
const FEATURE_VERSION = registry.version;
const validator = new FeatureValidator();

export class FeatureComputationService {
  constructor(options = {}) {
    this.featureVersion = FEATURE_VERSION;
    this.skipValidation = options.skipValidation === true;
  }

  async computeForBook(bookId) {
    const features = await this._computeFeatures(bookId);
    if (!features) {
      return { status: 'skipped', reason: 'no_source_data', bookId };
    }
    await this._upsert(bookId, features);
    return { status: 'ok', bookId, featureCount: Object.keys(features).length };
  }

  async computeBatch(bookIds) {
    const results = [];
    for (const bookId of bookIds) {
      const r = await this.computeForBook(bookId);
      results.push(r);
    }
    return { status: 'ok', batchSize: bookIds.length, results };
  }

  async computeAll() {
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT DISTINCT vj.book_id
           FROM video_jobs vj
          WHERE vj.status IN ('pending', 'active')
          ORDER BY vj.book_id`,
      );
      const bookIds = rows.map(r => r.book_id);
      if (bookIds.length === 0) {
        return { status: 'ok', bookCount: 0, reason: 'no_pending_jobs' };
      }
      return this.computeBatch(bookIds);
    } finally {
      client.release();
    }
  }

  async _computeFeatures(bookId) {
    const sourceData = await this._loadSourceData(bookId);
    if (!sourceData) return null;

    const featureVector = {};
    for (const feat of FEATURES) {
      featureVector[feat.feature_name] = this._computeFeature(feat, sourceData);
    }

    if (!this.skipValidation) {
      const { valid, errors, warnings } = validator.validate(featureVector);
      if (!valid) {
        console.warn(`[FeatureValidator] bookId=${bookId} invalid:`, errors.join('; '), warnings.join('; '));
      }
    }

    return featureVector;
  }

  async _loadSourceData(bookId) {
    const client = await pool.connect();
    try {
      const [
        { rows: engagementRows },
        { rows: snapshotRows },
        { rows: videoStateRows },
        { rows: recSegmentRows },
        { rows: scenarioRows },
        { rows: jobRows },
        { rows: audValidationRows },
        { rows: syncLogRows },
        { rows: syncFingerprintRows },
        { rows: bookEngagementRows },
      ] = await Promise.all([
        client.query(
          `SELECT request_count, ranking_score, request_count_decayed,
                  generation_priority_score, score_last_refreshed_at,
                  last_requested_at, created_at
             FROM book_did_engagement
            WHERE book_id = $1
            LIMIT 1`,
          [bookId],
        ),
        client.query(
          `SELECT request_count, ranking_score, captured_at
             FROM book_engagement_snapshots
            WHERE book_id = $1
           ORDER BY captured_at DESC`,
          [bookId],
        ),
        client.query(
          `SELECT status, retry_count, error_message, expires_at
             FROM smart_did_video_state
            WHERE book_id = $1
            LIMIT 1`,
          [bookId],
        ),
        client.query(
          `SELECT age_group, sort_order
             FROM book_recommendation_segments
            WHERE book_id = $1
            LIMIT 1`,
          [bookId],
        ),
        client.query(
          `SELECT scenario_type, state, priority, error_message
             FROM book_video_scenarios
            WHERE book_id = $1`,
          [bookId],
        ),
        client.query(
          `SELECT priority_score, did_request_retries, expires_at,
                  status, did_reported_status, retry_count, created_at
             FROM video_jobs
            WHERE book_id = $1
              AND status IN ('pending', 'active')
            LIMIT 1`,
          [bookId],
        ),
        client.query(
          `SELECT av.agreement_score, av.validator_count
             FROM audience_validation av
             JOIN video_jobs vj ON vj.id = av.video_id
            WHERE vj.book_id = $1`,
          [bookId],
        ),
        client.query(
          `SELECT status, record_count, source, synced_at
             FROM did_sync_log
            WHERE book_id = $1
           ORDER BY synced_at DESC`,
          [bookId],
        ),
        client.query(
          `SELECT last_synced_at, payload_hash
             FROM book_sync_fingerprints
            WHERE book_id = $1
            LIMIT 1`,
          [bookId],
        ),
        client.query(
          `SELECT engagement_count, user_id
             FROM book_engagement
            WHERE book_id = $1`,
          [bookId],
        ),
      ]);

      const be = engagementRows[0] || null;
      const svs = videoStateRows[0] || null;
      const bvs = scenarioRows[0] || null;
      const vj = jobRows[0] || null;
      const bsf = syncFingerprintRows[0] || null;
      const brs = recSegmentRows[0] || null;

      if (!be && !svs && !vj) {
        return null;
      }

      return {
        be,
        snapshots: snapshotRows,
        svs,
        brs,
        scenarios: scenarioRows,
        vj,
        audValidations: audValidationRows,
        syncLogs: syncLogRows,
        bsf,
        bookEngagements: bookEngagementRows,
        now: new Date(),
      };
    } finally {
      client.release();
    }
  }

  _computeFeature(feat, src) {
    switch (feat.feature_name) {
      case 'request_count':
        return src.be?.request_count ?? 0;
      case 'ranking_score': {
        const v = src.be?.ranking_score;
        if (v == null) return null;
        return v > 1 ? Math.min(v / 100.0, 1.0) : Math.max(v, 0);
      }
      case 'request_count_decayed': {
        const rc = src.be?.request_count ?? 0;
        const lastReq = src.be?.last_requested_at || src.be?.created_at;
        if (!lastReq) return 0;
        const hoursAgo = (src.now.getTime() - new Date(lastReq).getTime()) / 3600000;
        return Math.log(1 + rc) * Math.exp((-Math.LN2 / 30.0) * hoursAgo / 24.0);
      }
      case 'generation_priority_score':
        return src.be?.generation_priority_score ?? 0;
      case 'score_freshness_hours': {
        if (!src.be?.score_last_refreshed_at) return null;
        return (src.now.getTime() - new Date(src.be.score_last_refreshed_at).getTime()) / 3600000;
      }
      case 'snapshot_request_count_7d': {
        const cutoff = new Date(src.now.getTime() - 7 * 86400000);
        return src.snapshots
          .filter(s => new Date(s.captured_at) >= cutoff)
          .reduce((sum, s) => sum + (s.request_count ?? 0), 0);
      }
      case 'snapshot_request_count_30d': {
        const cutoff = new Date(src.now.getTime() - 30 * 86400000);
        return src.snapshots
          .filter(s => new Date(s.captured_at) >= cutoff)
          .reduce((sum, s) => sum + (s.request_count ?? 0), 0);
      }
      case 'snapshot_ranking_avg_30d': {
        const cutoff = new Date(src.now.getTime() - 30 * 86400000);
        const recent = src.snapshots.filter(s => new Date(s.captured_at) >= cutoff && s.ranking_score != null);
        if (recent.length === 0) return null;
        return recent.reduce((sum, s) => sum + s.ranking_score, 0) / recent.length;
      }
      case 'snapshot_count_90d': {
        const cutoff = new Date(src.now.getTime() - 90 * 86400000);
        return src.snapshots.filter(s => new Date(s.captured_at) >= cutoff).length;
      }
      case 'last_snapshot_hours_ago': {
        if (src.snapshots.length === 0) return null;
        return (src.now.getTime() - new Date(src.snapshots[0].captured_at).getTime()) / 3600000;
      }
      case 'video_status':
        return src.svs?.status ?? null;
      case 'video_retry_count':
        return Math.min(src.svs?.retry_count ?? 0, 10);
      case 'video_has_error':
        return src.svs?.error_message != null;
      case 'video_expires_hours': {
        if (!src.svs?.expires_at) return null;
        return (new Date(src.svs.expires_at).getTime() - src.now.getTime()) / 3600000;
      }
      case 'recommendation_age_group':
        return src.brs?.age_group ?? null;
      case 'recommendation_sort_order':
        return src.brs?.sort_order ?? null;
      case 'scenario_type':
        return src.scenarios.length > 0 ? src.scenarios[0].scenario_type : null;
      case 'scenario_state':
        return src.scenarios.length > 0 ? src.scenarios[0].state : null;
      case 'scenario_priority':
        return Math.max(...src.scenarios.map(s => s.priority ?? 0), 0);
      case 'scenario_has_error':
        return src.scenarios.some(s => s.error_message != null);
      case 'scenario_count':
        return src.scenarios.length;
      case 'video_job_priority_score':
        return src.vj?.priority_score ?? 0;
      case 'job_did_request_retries':
        return Math.min(src.vj?.did_request_retries ?? 0, 10);
      case 'job_expires_hours': {
        if (!src.vj?.expires_at) return null;
        return (new Date(src.vj.expires_at).getTime() - src.now.getTime()) / 3600000;
      }
      case 'job_status':
        return src.vj?.status ?? null;
      case 'job_reported_status':
        return src.vj?.did_reported_status ?? null;
      case 'job_retry_count':
        return Math.min(src.vj?.retry_count ?? 0, 10);
      case 'job_starvation_days': {
        if (!src.vj?.created_at) return 0;
        const days = (src.now.getTime() - new Date(src.vj.created_at).getTime()) / 86400000;
        return Math.min(days, 7);
      }
      case 'agreement_score': {
        const scores = src.audValidations.filter(a => a.agreement_score != null);
        if (scores.length === 0) return 0;
        return scores.reduce((sum, a) => sum + a.agreement_score, 0) / scores.length;
      }
      case 'validator_count':
        return src.audValidations.reduce((sum, a) => sum + (a.validator_count ?? 0), 0);
      case 'sync_success_rate_7d': {
        const cutoff = new Date(src.now.getTime() - 7 * 86400000);
        const recent = src.syncLogs.filter(l => new Date(l.synced_at) >= cutoff);
        if (recent.length === 0) return null;
        return recent.filter(l => l.status === 'success').length / recent.length;
      }
      case 'sync_record_count_30d': {
        const cutoff = new Date(src.now.getTime() - 30 * 86400000);
        return src.syncLogs
          .filter(l => new Date(l.synced_at) >= cutoff)
          .reduce((sum, l) => sum + (l.record_count ?? 0), 0);
      }
      case 'sync_total_errors_7d': {
        const cutoff = new Date(src.now.getTime() - 7 * 86400000);
        return src.syncLogs
          .filter(l => l.status === 'failed' && new Date(l.synced_at) >= cutoff)
          .length;
      }
      case 'sync_source_webhook_ratio': {
        const cutoff = new Date(src.now.getTime() - 30 * 86400000);
        const recent = src.syncLogs.filter(l => new Date(l.synced_at) >= cutoff);
        if (recent.length === 0) return null;
        return recent.filter(l => l.source === 'webhook').length / recent.length;
      }
      case 'hours_since_last_sync': {
        if (!src.bsf?.last_synced_at) return null;
        return (src.now.getTime() - new Date(src.bsf.last_synced_at).getTime()) / 3600000;
      }
      case 'payload_hash_changed': {
        if (!src.bsf?.payload_hash) return null;
        return false;
      }
      case 'engagement_type_count':
        return src.bookEngagements.reduce((sum, e) => sum + (e.engagement_count ?? 0), 0);
      case 'distinct_engagement_users': {
        const userIds = new Set(src.bookEngagements.map(e => e.user_id).filter(Boolean));
        return userIds.size;
      }
      default:
        return null;
    }
  }

  async _upsert(bookId, featureVector) {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO ml_book_features (book_id, features, feature_version, computed_at, updated_at)
         VALUES ($1, $2::jsonb, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [bookId, JSON.stringify(featureVector), this.featureVersion],
      );
    } finally {
      client.release();
    }
  }
}
