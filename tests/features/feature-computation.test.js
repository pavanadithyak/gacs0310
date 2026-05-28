import { describe, expect, jest, test } from '@jest/globals';

const MOCK_REGISTRY = {
  version: '0.1.0',
  features: [
    { feature_name: 'request_count', feature_type: 'numeric', nullable: false, source_table: 'book_did_engagement', source_column: 'request_count', aggregation: { window: 'point_in_time', function: 'latest' } },
    { feature_name: 'ranking_score', feature_type: 'numeric', nullable: true, source_table: 'book_did_engagement', source_column: 'ranking_score', aggregation: { window: 'point_in_time', function: 'latest' } },
    { feature_name: 'video_has_error', feature_type: 'boolean', nullable: false, source_table: 'smart_did_video_state', source_column: 'error_message', aggregation: { window: 'point_in_time', function: 'latest' } },
    { feature_name: 'scenario_state', feature_type: 'categorical', nullable: false, source_table: 'book_video_scenarios', source_column: 'state', aggregation: { window: 'point_in_time', function: 'latest' } },
    { feature_name: 'scenario_count', feature_type: 'numeric', nullable: false, source_table: 'book_video_scenarios', source_column: 'scenario_type', aggregation: { window: 'all_time', function: 'count' } },
    { feature_name: 'snapshot_count_90d', feature_type: 'numeric', nullable: false, source_table: 'book_engagement_snapshots', source_column: 'captured_at', aggregation: { window: '90d', function: 'count' } },
    { feature_name: 'job_starvation_days', feature_type: 'numeric', nullable: false, source_table: 'video_jobs', source_column: 'created_at', aggregation: { window: 'point_in_time', function: 'max' } },
    { feature_name: 'engagement_type_count', feature_type: 'numeric', nullable: false, source_table: 'book_engagement', source_column: 'engagement_count', aggregation: { window: 'all_time', function: 'sum' } },
    { feature_name: 'video_status', feature_type: 'categorical', nullable: true, source_table: 'smart_did_video_state', source_column: 'status', aggregation: { window: 'point_in_time', function: 'latest' } },
    { feature_name: 'distinct_engagement_users', feature_type: 'numeric', nullable: false, source_table: 'book_engagement', source_column: 'user_id', aggregation: { window: 'all_time', function: 'count' } },
  ],
};

const mockQuery = jest.fn();
const mockConnect = jest.fn();
const mockRelease = jest.fn();
const mockClient = { query: mockQuery, release: mockRelease };

jest.unstable_mockModule('../../src/db/client.js', () => ({ default: { connect: mockConnect, query: mockQuery } }));
jest.unstable_mockModule('../../src/features/feature-registry.json', () => ({ default: MOCK_REGISTRY }));
jest.unstable_mockModule('../../src/features/feature-validator.js', () => {
  class MockValidator {
    validate() { return { valid: true, errors: [], warnings: [] }; }
  }
  return { FeatureValidator: MockValidator };
});

let FeatureComputationService;

beforeAll(async () => {
  const mod = await import('../../src/features/feature-computation.service.js');
  FeatureComputationService = mod.FeatureComputationService;
});

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
  mockRelease.mockReset();
  mockConnect.mockResolvedValue(mockClient);
});

describe('FeatureComputationService', () => {
  test('computeForBook computes and upserts features', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ request_count: 10, ranking_score: 0.8, request_count_decayed: 5.2, generation_priority_score: 42, score_last_refreshed_at: null, last_requested_at: null, created_at: '2026-05-01T00:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: 'available', retry_count: 0, error_message: null, expires_at: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ priority_score: 50, did_request_retries: 0, expires_at: null, status: 'pending', did_reported_status: null, retry_count: 0, created_at: '2026-05-27T00:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ last_synced_at: null, payload_hash: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const service = new FeatureComputationService({ skipValidation: true });
    const result = await service.computeForBook('book-uuid-1');

    expect(result.status).toBe('ok');
    expect(result.bookId).toBe('book-uuid-1');
    expect(result.featureCount).toBe(10);

    const insertCall = mockQuery.mock.calls.find(c => c[0] && c[0].includes('INSERT INTO ml_book_features'));
    expect(insertCall).toBeTruthy();
    expect(insertCall[1][0]).toBe('book-uuid-1');
  });

  test('computeForBook returns skipped when no source data', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const service = new FeatureComputationService();
    const result = await service.computeForBook('book-uuid-missing');
    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('no_source_data');
  });

  test('computeForBook handles null values for nullable features', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ request_count: 5, ranking_score: null, request_count_decayed: 2.1, generation_priority_score: 30, score_last_refreshed_at: null, last_requested_at: null, created_at: '2026-05-01T00:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ priority_score: 0, did_request_retries: 0, expires_at: null, status: 'pending', did_reported_status: null, retry_count: 0, created_at: '2026-05-27T00:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ last_synced_at: null, payload_hash: null }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const service = new FeatureComputationService({ skipValidation: true });
    const result = await service.computeForBook('book-uuid-2');
    expect(result.status).toBe('ok');
  });

  test('computeBatch processes multiple books', async () => {
    mockQuery
      .mockResolvedValue({ rows: [{ request_count: 1, ranking_score: 0.5, request_count_decayed: 0.5, generation_priority_score: 10, score_last_refreshed_at: null, last_requested_at: null, created_at: '2026-05-01T00:00:00Z' }] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [{ priority_score: 0, did_request_retries: 0, expires_at: null, status: 'pending', did_reported_status: null, retry_count: 0, created_at: '2026-05-27T00:00:00Z' }] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [{ last_synced_at: null, payload_hash: null }] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [] });

    const service = new FeatureComputationService({ skipValidation: true });
    const result = await service.computeBatch(['bid-1', 'bid-2']);
    expect(result.status).toBe('ok');
    expect(result.batchSize).toBe(2);
    expect(result.results).toHaveLength(2);
  });

  test('computeAll returns no_pending_jobs when none found', async () => {
    mockConnect.mockResolvedValue(mockClient);
    mockQuery.mockResolvedValue({ rows: [] });

    const service = new FeatureComputationService();
    const result = await service.computeAll();
    expect(result.status).toBe('ok');
    expect(result.reason).toBe('no_pending_jobs');
  });

  test('computeAll queries pending/active video_jobs', async () => {
    mockConnect.mockResolvedValue(mockClient);
    mockQuery
      .mockResolvedValueOnce({ rows: [{ book_id: 'b1' }, { book_id: 'b2' }] })
      .mockResolvedValue({ rows: [{ request_count: 1, ranking_score: 0.5, request_count_decayed: 0.5, generation_priority_score: 10, score_last_refreshed_at: null, last_requested_at: null, created_at: '2026-05-01T00:00:00Z' }] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [{ priority_score: 0, did_request_retries: 0, expires_at: null, status: 'pending', did_reported_status: null, retry_count: 0, created_at: '2026-05-27T00:00:00Z' }] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [{ last_synced_at: null, payload_hash: null }] })
      .mockResolvedValue({ rows: [] })
      .mockResolvedValue({ rows: [] });

    const service = new FeatureComputationService({ skipValidation: true });
    const result = await service.computeAll();

    expect(result.status).toBe('ok');
    expect(result.batchSize).toBe(2);

    const queryCall = mockQuery.mock.calls[0];
    expect(queryCall[0]).toContain('video_jobs');
    expect(queryCall[0]).toContain('pending');
    expect(queryCall[0]).toContain('active');
  });

  test('handles DB error gracefully during compute', async () => {
    mockConnect.mockRejectedValue(new Error('Connection lost'));

    const service = new FeatureComputationService();
    await expect(service.computeForBook('bid-1')).rejects.toThrow('Connection lost');
  });
});
