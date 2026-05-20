import db from '../../db/client.js';

const SYNC_NAME = 'smart_did.video_records';

export class DidSyncRepository {
  constructor({ database = db } = {}) {
    this.db = database;
  }

  async getCursor() {
    const result = await this.db.query(
      `SELECT cursor_updated_at, cursor_external_id
       FROM did_sync_state
       WHERE sync_name = $1`,
      [SYNC_NAME],
    );

    return result.rows[0] || null;
  }

  async markStarted() {
    await this.db.query(
      `INSERT INTO did_sync_state (sync_name, last_started_at, updated_at)
       VALUES ($1, NOW(), NOW())
       ON CONFLICT (sync_name)
       DO UPDATE SET last_started_at = NOW(), updated_at = NOW()`,
      [SYNC_NAME],
    );
  }

  async markFailed(error) {
    await this.db.query(
      `INSERT INTO did_sync_state (sync_name, last_error, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (sync_name)
       DO UPDATE SET last_error = $2, updated_at = NOW()`,
      [SYNC_NAME, error.message],
    );
  }

  async applyBatch(records, nextCursor) {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      const summary = {
        insertedOrUpdated: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
      };

      for (const record of records) {
        try {
          const bookId = await this.resolveBookId(client, record.externalBookId);

          if (!bookId) {
            summary.skipped += 1;
            await this.insertSyncLog(client, record, 'skipped', null, 'No matching GACS book');
            continue;
          }

          const changed = await this.upsertEngagement(client, bookId, record);
          await this.updateVideoJobState(client, bookId, record);
          await this.insertSyncLog(client, record, 'success', bookId);

          if (changed) summary.insertedOrUpdated += 1;
          else summary.unchanged += 1;
        } catch (err) {
          summary.failed += 1;
          await this.insertSyncLog(client, record, 'failed', null, err.message);
        }
      }

      if (nextCursor) {
        await client.query(
          `INSERT INTO did_sync_state (
             sync_name,
             cursor_updated_at,
             cursor_external_id,
             last_success_at,
             last_error,
             updated_at
           )
           VALUES ($1, $2, $3, NOW(), NULL, NOW())
           ON CONFLICT (sync_name)
           DO UPDATE SET
             cursor_updated_at = $2,
             cursor_external_id = $3,
             last_success_at = NOW(),
             last_error = NULL,
             updated_at = NOW()`,
          [SYNC_NAME, nextCursor.cursorUpdatedAt, nextCursor.cursorExternalId],
        );
      }

      await client.query('COMMIT');
      return summary;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveBookId(client, externalBookId) {
    const refResult = await client.query(
      `SELECT book_id
       FROM book_external_refs
       WHERE source_system = 'smart_did'
         AND external_book_id = $1
       ORDER BY first_seen_at ASC
       LIMIT 1`,
      [externalBookId],
    );

    if (refResult.rows[0]?.book_id) {
      return refResult.rows[0].book_id;
    }

    const jobResult = await client.query(
      `SELECT book_id
       FROM video_jobs
       WHERE external_ref_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [externalBookId],
    );

    return jobResult.rows[0]?.book_id || null;
  }

  async upsertEngagement(client, bookId, record) {
    const result = await client.query(
      `INSERT INTO book_engagement (
         book_id,
         source_system,
         request_count,
         ranking_score,
         last_requested_at,
         synced_at,
         created_at,
         updated_at
       )
       VALUES ($1, 'smart_did', $2, $3, $4, NOW(), NOW(), NOW())
       ON CONFLICT (book_id)
       DO UPDATE SET
         source_system = EXCLUDED.source_system,
         request_count = EXCLUDED.request_count,
         ranking_score = EXCLUDED.ranking_score,
         last_requested_at = EXCLUDED.last_requested_at,
         synced_at = NOW(),
         updated_at = NOW()
       WHERE book_engagement.request_count IS DISTINCT FROM EXCLUDED.request_count
          OR book_engagement.ranking_score IS DISTINCT FROM EXCLUDED.ranking_score
          OR book_engagement.last_requested_at IS DISTINCT FROM EXCLUDED.last_requested_at
       RETURNING book_id`,
      [bookId, record.requestCount, record.rankingScore, record.lastRequestedAt],
    );

    return result.rowCount > 0;
  }

  async updateVideoJobState(client, bookId, record) {
    await client.query(
      `UPDATE video_jobs
       SET did_reported_status = $2,
           did_request_retries = $3,
           expires_at = $4,
           did_status_synced_at = NOW()
       WHERE job_id = (
         SELECT job_id
         FROM video_jobs
         WHERE book_id = $1
         ORDER BY created_at DESC
         LIMIT 1
       )
       AND (
         did_reported_status IS DISTINCT FROM $2
         OR did_request_retries IS DISTINCT FROM $3
         OR expires_at IS DISTINCT FROM $4
       )`,
      [bookId, record.status, record.retryCount, record.expiresAt],
    );
  }

  async insertSyncLog(client, record, status, bookId = null, errorMessage = null) {
    const idempotencyKey = [
      'smart_did',
      'incremental_sync',
      record.externalBookId,
      record.updatedAt.toISOString(),
      status,
    ].join(':');

    await client.query(
      `INSERT INTO did_sync_log (
         source_system,
         sync_type,
         status,
         book_id,
         external_book_id,
         payload_json,
         error_message,
         idempotency_key,
         synced_at
       )
       VALUES (
         'smart_did',
         'incremental_sync',
         $1,
         $2,
         $3,
         $4::jsonb,
         $5,
         $6,
         NOW()
       )
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        status,
        bookId,
        record.externalBookId,
        JSON.stringify(record.raw),
        errorMessage,
        idempotencyKey,
      ],
    );
  }
}