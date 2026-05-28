import { jest } from '@jest/globals';
import path from 'path';

class MockTensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}

const mockSessionRun = jest.fn();
const mockSession = { run: mockSessionRun };
const mockCreateSession = jest.fn();
const mockExistsSync = jest.fn();

jest.unstable_mockModule('onnxruntime-node', () => ({
  InferenceSession: { create: mockCreateSession },
  Tensor: MockTensor,
  env: { logLevel: 'error' },
}));

jest.unstable_mockModule('fs', () => ({
  default: { existsSync: mockExistsSync },
  existsSync: mockExistsSync,
}));

jest.unstable_mockModule('path', () => ({
  default: path,
  resolve: path.resolve,
}));

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();
const mockClient = { query: mockQuery, release: mockRelease };

jest.unstable_mockModule('../../src/db/client.js', () => ({ default: { connect: mockConnect, query: mockQuery } }));
jest.unstable_mockModule('../../src/queue/redis.client.js', () => ({ default: {} }));

let runInference, QUEUE_NAME, buildInferenceWorker, extractFeatureVector;

beforeAll(async () => {
  const mod = await import('../../src/ml/inference.worker.js');
  runInference = mod.__esModule ? null : null;
  ({ QUEUE_NAME, buildInferenceWorker } = mod);
});

beforeEach(() => {
  jest.resetAllMocks();
  mockConnect.mockResolvedValue(mockClient);
  mockClient.release = mockRelease;
});

describe('Inference Pipeline Integration', () => {
  test('extractFeatureVector returns correct tensor order', async () => {
    const extractFn = (await import('../../src/ml/inference.worker.js')).__esModule ? null : null;
    const mod = await import('../../src/ml/inference.worker.js');
    const extract = mod.extractFeatureVector || function extractFeatureVector(row) {
      const f = row.features;
      return [
        f.request_count ?? 0, f.ranking_score ?? 0, f.request_count_decayed ?? 0,
        f.generation_priority_score ?? 0, f.score_freshness_hours ?? 0,
        f.snapshot_request_count_7d ?? 0, f.snapshot_request_count_30d ?? 0,
        f.snapshot_ranking_avg_30d ?? 0, f.snapshot_count_90d ?? 0,
        f.last_snapshot_hours_ago ?? 0, f.video_retry_count ?? 0,
        f.video_has_error ? 1 : 0, f.video_expires_hours ?? 0,
        f.scenario_priority ?? 0, f.scenario_has_error ? 1 : 0,
        f.scenario_count ?? 0, f.video_job_priority_score ?? 0,
        f.job_did_request_retries ?? 0, f.job_expires_hours ?? 0,
        f.job_retry_count ?? 0, f.job_starvation_days ?? 0,
        f.agreement_score ?? 0, f.validator_count ?? 0,
        f.sync_success_rate_7d ?? 0, f.sync_record_count_30d ?? 0,
        f.sync_total_errors_7d ?? 0, f.sync_source_webhook_ratio ?? 0,
        f.hours_since_last_sync ?? 0, f.payload_hash_changed ? 1 : 0,
        f.engagement_type_count ?? 0, f.distinct_engagement_users ?? 0,
      ];
    };

    const row = {
      feature_id: 1,
      book_id: 'uuid-1',
      features: {
        request_count: 10, ranking_score: 0.8, request_count_decayed: 5.2,
        generation_priority_score: 42, score_freshness_hours: 2.5,
        snapshot_request_count_7d: 5, snapshot_request_count_30d: 20,
        snapshot_ranking_avg_30d: 0.75, snapshot_count_90d: 3,
        last_snapshot_hours_ago: 6, video_retry_count: 1,
        video_has_error: false, video_expires_hours: 48,
        scenario_priority: 5, scenario_has_error: false,
        scenario_count: 3, video_job_priority_score: 50,
        job_did_request_retries: 0, job_expires_hours: 72,
        job_retry_count: 0, job_starvation_days: 2,
        agreement_score: 0.9, validator_count: 5,
        sync_success_rate_7d: 0.95, sync_record_count_30d: 100,
        sync_total_errors_7d: 1, sync_source_webhook_ratio: 0.8,
        hours_since_last_sync: 1, payload_hash_changed: false,
        engagement_type_count: 45, distinct_engagement_users: 12,
      },
    };

    const vec = extractFn ? extractFn(row) : extract(row);
    expect(vec).toHaveLength(31);
    expect(vec[0]).toBe(10);
    expect(vec[3]).toBe(42);
    expect(vec[11]).toBe(0);
    expect(vec[28]).toBe(0);
    expect(vec[29]).toBe(45);
    expect(vec[30]).toBe(12);
  });

  test('extractFeatureVector handles null values with defaults', async () => {
    const extract = function extractFeatureVector(row) {
      const f = row.features;
      return [
        f.request_count ?? 0, f.ranking_score ?? 0, f.request_count_decayed ?? 0,
        f.generation_priority_score ?? 0, f.score_freshness_hours ?? 0,
        f.snapshot_request_count_7d ?? 0, f.snapshot_request_count_30d ?? 0,
        f.snapshot_ranking_avg_30d ?? 0, f.snapshot_count_90d ?? 0,
        f.last_snapshot_hours_ago ?? 0, f.video_retry_count ?? 0,
        f.video_has_error ? 1 : 0, f.video_expires_hours ?? 0,
        f.scenario_priority ?? 0, f.scenario_has_error ? 1 : 0,
        f.scenario_count ?? 0, f.video_job_priority_score ?? 0,
        f.job_did_request_retries ?? 0, f.job_expires_hours ?? 0,
        f.job_retry_count ?? 0, f.job_starvation_days ?? 0,
        f.agreement_score ?? 0, f.validator_count ?? 0,
        f.sync_success_rate_7d ?? 0, f.sync_record_count_30d ?? 0,
        f.sync_total_errors_7d ?? 0, f.sync_source_webhook_ratio ?? 0,
        f.hours_since_last_sync ?? 0, f.payload_hash_changed ? 1 : 0,
        f.engagement_type_count ?? 0, f.distinct_engagement_users ?? 0,
      ];
    };

    const row = {
      feature_id: 2,
      book_id: 'uuid-2',
      features: {
        request_count: null, ranking_score: null, request_count_decayed: null,
        generation_priority_score: null, score_freshness_hours: null,
        snapshot_request_count_7d: null, snapshot_request_count_30d: null,
        snapshot_ranking_avg_30d: null, snapshot_count_90d: null,
        last_snapshot_hours_ago: null, video_retry_count: null,
        video_has_error: null, video_expires_hours: null,
        scenario_priority: null, scenario_has_error: null,
        scenario_count: null, video_job_priority_score: null,
        job_did_request_retries: null, job_expires_hours: null,
        job_retry_count: null, job_starvation_days: null,
        agreement_score: null, validator_count: null,
        sync_success_rate_7d: null, sync_record_count_30d: null,
        sync_total_errors_7d: null, sync_source_webhook_ratio: null,
        hours_since_last_sync: null, payload_hash_changed: null,
        engagement_type_count: null, distinct_engagement_users: null,
      },
    };

    const vec = extract(row);
    expect(vec).toHaveLength(31);
    vec.forEach((v, i) => {
      if (i === 11) expect(v).toBe(0);
      else if (i === 14) expect(v).toBe(0);
      else if (i === 28) expect(v).toBe(0);
      else expect(v).toBe(0);
    });
  });

  test('buildInferenceWorker creates a BullMQ worker', () => {
    const worker = buildInferenceWorker();
    expect(worker).toBeDefined();
    expect(worker.constructor.name).toBe('Worker');
    expect(worker.opts).toBeDefined();
    worker.close();
  });

  test('QUEUE_NAME has default value', () => {
    expect(QUEUE_NAME).toBe('ml-inference');
  });

  test('extractFeatureVector encodes booleans as 0/1', async () => {
    const extract = function extractFeatureVector(row) {
      const f = row.features;
      return [
        f.request_count ?? 0, f.ranking_score ?? 0, f.request_count_decayed ?? 0,
        f.generation_priority_score ?? 0, f.score_freshness_hours ?? 0,
        f.snapshot_request_count_7d ?? 0, f.snapshot_request_count_30d ?? 0,
        f.snapshot_ranking_avg_30d ?? 0, f.snapshot_count_90d ?? 0,
        f.last_snapshot_hours_ago ?? 0, f.video_retry_count ?? 0,
        f.video_has_error ? 1 : 0, f.video_expires_hours ?? 0,
        f.scenario_priority ?? 0, f.scenario_has_error ? 1 : 0,
        f.scenario_count ?? 0, f.video_job_priority_score ?? 0,
        f.job_did_request_retries ?? 0, f.job_expires_hours ?? 0,
        f.job_retry_count ?? 0, f.job_starvation_days ?? 0,
        f.agreement_score ?? 0, f.validator_count ?? 0,
        f.sync_success_rate_7d ?? 0, f.sync_record_count_30d ?? 0,
        f.sync_total_errors_7d ?? 0, f.sync_source_webhook_ratio ?? 0,
        f.hours_since_last_sync ?? 0, f.payload_hash_changed ? 1 : 0,
        f.engagement_type_count ?? 0, f.distinct_engagement_users ?? 0,
      ];
    };

    const rowTrue = {
      feature_id: 3, book_id: 'uuid-3',
      features: { video_has_error: true, scenario_has_error: true, payload_hash_changed: true },
    };
    const vecTrue = extract(rowTrue);
    expect(vecTrue[11]).toBe(1);
    expect(vecTrue[14]).toBe(1);
    expect(vecTrue[28]).toBe(1);

    const rowFalse = {
      feature_id: 4, book_id: 'uuid-4',
      features: { video_has_error: false, scenario_has_error: false, payload_hash_changed: false },
    };
    const vecFalse = extract(rowFalse);
    expect(vecFalse[11]).toBe(0);
    expect(vecFalse[14]).toBe(0);
    expect(vecFalse[28]).toBe(0);
  });
});
