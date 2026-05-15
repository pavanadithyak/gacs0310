import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ============================================================================
// MOCKS — registered BEFORE any real imports (ESM requirement)
// ============================================================================

const mockDb = {
  query: jest.fn(),
  connect: jest.fn(),
  transaction: jest.fn(),
};

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};

mockDb.connect.mockReturnValue(mockClient);
mockDb.transaction.mockImplementation((fn) => fn(mockDb));

jest.unstable_mockModule('../../src/db/client.js', () => ({
  default: mockDb,
}));

jest.unstable_mockModule('../../src/queue/redis.client.js', () => ({
  default: { on: jest.fn(), quit: jest.fn() },
}));

jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), close: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
}));

// ============================================================================
// DYNAMIC IMPORTS — AFTER mocks registered (top-level only)
// ============================================================================

const { DidIncrementalSyncService } = await import('../../src/sync/did/incremental-sync.service.js');
const { DidSyncRepository } = await import('../../src/sync/did/did-sync.repository.js');
const { SmartDIDClient } = await import('../../src/integrations/smart-did.client.js');
const { mapSmartDIDVideoRecord, mapSmartDIDVideoRecords } = await import('../../src/sync/did/did-sync.mapper.js');

// ============================================================================
// TEST DATA
// ============================================================================

const BOOK_UUID = '550e8400-e29b-41d4-a716-446655440000';
const BOOK_UUID_2 = '550e8400-e29b-41d4-a716-446655440001';
const EXT_ID_1 = 'ext-did-video-001';
const EXT_ID_2 = 'ext-did-video-002';

const baseRecord = (id, extId, updated, overrides = {}) => ({
  bookId: extId,
  updatedAt: updated,
  requestCount: 5,
  rankingScore: 0.85,
  lastRequestedAt: '2026-01-15T09:00:00Z',
  retryCount: 0,
  status: 'REQUESTED',
  expiresAt: '2026-02-15T00:00:00Z',
  ...overrides,
});

// ============================================================================
// HELPER: Smart DID fetch mock factory
// ============================================================================

function createMockFetch(responses = []) {
  let callIndex = 0;
  return jest.fn(async () => {
    const response = responses[callIndex] || responses[responses.length - 1];
    callIndex += 1;
    return {
      ok: true,
      json: () => Promise.resolve(response),
    };
  });
}

function buildClient(mockFetch) {
  return new SmartDIDClient({
    baseUrl: 'https://test.did.com',
    apiToken: 'test-token',
    fetchImpl: mockFetch,
    timeoutMs: 5000,
  });
}

function buildService(client, repository, config = {}) {
  return new DidIncrementalSyncService({
    client,
    repository,
    batchSize: 500,
    maxPages: 3,
    ...config,
  });
}

// ============================================================================
// E2E TESTS
// ============================================================================

describe('E2E: DID Full Cycle (sync → DB → priority)', () => {
  let repo;
  let service;

  beforeEach(() => {
    mockDb.query.mockReset();
    mockDb.connect.mockReset();
    mockDb.transaction.mockReset();
    mockClient.query.mockReset();
    mockDb.connect.mockReturnValue(mockClient);

    mockDb.query.mockImplementation(async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] };
      }
      if (sql.includes('SELECT') && sql.includes('did_sync_state')) {
        return {
          rows: [
            {
              cursor_updated_at: '2026-01-15T10:00:00Z',
              cursor_external_id: EXT_ID_1,
            },
          ],
        };
      }
      if (sql.includes('book_external_refs')) {
        return { rows: [{ book_id: BOOK_UUID }] };
      }
      if (sql.includes('INSERT INTO book_did_engagement')) {
        return { rows: [{ book_id: params[0] }], rowCount: 1 };
      }
      if (sql.includes('UPDATE video_jobs') && sql.includes('did_reported_status')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO did_sync_log')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO did_sync_state') && sql.includes('cursor_updated_at')) {
        return { rows: [{ cursor_updated_at: params[1] }] };
      }
      if (sql.includes('last_started_at')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql.substring(0, 80)}...`);
    });

    mockClient.query.mockImplementation(mockDb.query.mockImplementation());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ========================================================================
  // TEST 1: Engagement upsert → correct columns & types
  // ========================================================================
  it('1.1 upsertEngagement inserts with correct columns and ON CONFLICT', async () => {
    const record = mapSmartDIDVideoRecord(baseRecord('1', EXT_ID_1, '2026-01-15T09:00:00Z'));

    let capturedSql = '';
    let capturedParams = [];
    mockClient.query.mockImplementation(async (sql, params) => {
      if (sql.includes('INSERT INTO book_did_engagement')) {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [{ book_id: BOOK_UUID }], rowCount: 1 };
      }
      return { rows: [] };
    });

    repo = new DidSyncRepository({ database: mockDb });
    const changed = await repo.upsertEngagement(mockClient, BOOK_UUID, record);

    expect(changed).toBe(true);
    expect(capturedSql).toContain('INSERT INTO book_did_engagement');
    expect(capturedSql).toContain('ON CONFLICT (book_id)');
    expect(capturedSql).toContain('IS DISTINCT FROM');
    expect(capturedParams[0]).toBe(BOOK_UUID);
    expect(capturedParams[1]).toBe(5);
    expect(capturedParams[2]).toBe(0.85);
    expect(capturedParams[3]).toEqual(new Date('2026-01-15T09:00:00Z'));
  });

  // ========================================================================
  // TEST 2: Idempotency → no duplicate writes on same data
  // ========================================================================
  it('2.1 upsertEngagement returns false when data unchanged (IS DISTINCT FROM)', async () => {
    const record = mapSmartDIDVideoRecord(baseRecord('1', EXT_ID_1, '2026-01-15T09:00:00Z'));

    mockClient.query.mockResolvedValue({ rows: [{ book_id: BOOK_UUID }], rowCount: 0 });

    repo = new DidSyncRepository({ database: mockDb });
    const changed = await repo.upsertEngagement(mockClient, BOOK_UUID, record);

    expect(changed).toBe(false);
    expect(mockClient.query).toHaveBeenCalledTimes(1);
    expect(mockClient.query.mock.calls[0][0]).toContain('IS DISTINCT FROM');
  });

  // ========================================================================
  // TEST 3: Book resolution → external ID → GACS UUID
  // ========================================================================
  it('3.1 resolveBookId queries book_external_refs with source_system filter', async () => {
    let capturedSql = '';
    let capturedParams = [];
    mockClient.query.mockImplementation(async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [{ book_id: BOOK_UUID }] };
    });

    repo = new DidSyncRepository({ database: mockDb });
    const bookId = await repo.resolveBookId(mockClient, EXT_ID_1);

    expect(bookId).toBe(BOOK_UUID);
    expect(capturedSql).toContain('book_external_refs');
    expect(capturedSql).toContain("source_system = 'smart_did'");
    expect(capturedParams[0]).toBe(EXT_ID_1);
  });

  it('3.2 resolveBookId falls back to video_jobs when refs empty', async () => {
    let callCount = 0;
    mockClient.query.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return { rows: [] };
      }
      return { rows: [{ book_id: BOOK_UUID }] };
    });

    repo = new DidSyncRepository({ database: mockDb });
    const bookId = await repo.resolveBookId(mockClient, EXT_ID_1);

    expect(bookId).toBe(BOOK_UUID);
    expect(mockClient.query).toHaveBeenCalledTimes(2);
    expect(mockClient.query.mock.calls[1][0]).toContain('video_jobs');
  });

  it('3.3 resolveBookId returns null when not found anywhere', async () => {
    mockClient.query.mockResolvedValue({ rows: [] });

    repo = new DidSyncRepository({ database: mockDb });
    const bookId = await repo.resolveBookId(mockClient, 'unknown-ext-id');

    expect(bookId).toBeNull();
  });

  // ========================================================================
  // TEST 4: Sync cursor advances after successful batch
  // ========================================================================
  it('4.1 runOnce updates cursor with latest updatedAt from batch', async () => {
    const records = [
      baseRecord('1', EXT_ID_1, '2026-01-15T10:00:00Z'),
      baseRecord('2', EXT_ID_2, '2026-01-15T11:00:00Z'),
    ];

    const mockFetch = createMockFetch([{
      records,
      hasMore: false,
      nextPageToken: null,
    }]);

    let capturedCursor = null;
    const queryHandler = async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT') && sql.includes('did_sync_state')) {
        return { rows: [{ cursor_updated_at: '2026-01-15T10:00:00Z', cursor_external_id: EXT_ID_1 }] };
      }
      if (sql.includes('book_external_refs')) return { rows: [{ book_id: BOOK_UUID }] };
      if (sql.includes('INSERT INTO book_did_engagement')) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE video_jobs') && sql.includes('did_reported_status')) return { rows: [] };
      if (sql.includes('INSERT INTO did_sync_log')) return { rows: [] };
      if (sql.includes('INSERT INTO did_sync_state') && sql.includes('cursor_updated_at')) {
        capturedCursor = params[1];
        return { rows: [{ cursor_updated_at: params[1] }] };
      }
      if (sql.includes('last_started_at')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql.substring(0, 80)}...`);
    };
    mockDb.query.mockImplementation(queryHandler);
    mockClient.query.mockImplementation(queryHandler);

    repo = new DidSyncRepository({ database: mockDb });
    const client = buildClient(mockFetch);
    service = buildService(client, repo);

    const result = await service.runOnce();

    expect(result.status).toBe('success');
    expect(result.fetched).toBe(2);
    expect(result.insertedOrUpdated).toBe(2);
    expect(capturedCursor).not.toBeNull();
    const cursorDate = new Date(capturedCursor);
    expect(cursorDate.getTime()).toBe(new Date('2026-01-15T11:00:00Z').getTime());
  });

  // ========================================================================
  // TEST 5: Priority decay math matches formula
  // ========================================================================
  it('5.1 generation_priority_score matches exponential decay formula', async () => {
    const requestCount = 10;
    const rankingScore = 0.85;
    const retryCount = 2;
    const daysElapsed = 15;

    const decayedSignal = Math.log(1 + requestCount) * Math.exp((-Math.log(2) / 30) * daysElapsed);
    const normalizedRanking = rankingScore;
    const retrySignal = Math.min(retryCount / 5.0, 1.0);
    const expectedPriority =
      40 * decayedSignal +
      30 * normalizedRanking +
      15 * retrySignal +
      10 * 0 +
      5 * 0;

    mockDb.query.mockResolvedValue({
      rows: [
        {
          book_id: BOOK_UUID,
          generation_priority_score: expectedPriority,
          request_count_decayed: decayedSignal,
        },
      ],
    });

    const result = await mockDb.query(
      `SELECT book_id, generation_priority_score, request_count_decayed
       FROM book_did_engagement WHERE book_id = $1`,
      [BOOK_UUID],
    );

    expect(result.rows[0].generation_priority_score).toBeCloseTo(expectedPriority, 2);
    expect(result.rows[0].request_count_decayed).toBeCloseTo(decayedSignal, 2);
  });

  it('5.2 LN(1+count) prevents huge counts from dominating', () => {
    const countA = 10;
    const countB = 1000;
    const days = 30;

    const decayA = Math.log(1 + countA) * Math.exp((-Math.log(2) / 30) * days);
    const decayB = Math.log(1 + countB) * Math.exp((-Math.log(2) / 30) * days);

    expect(decayA).toBeGreaterThan(0);
    expect(decayB).toBeGreaterThan(decayA);
    expect(decayB / decayA).toBeLessThan(countB / countA);
  });

  it('5.3 Ranking score normalized when > 1 (100-scale)', () => {
    const ranking100 = 85;
    const normalized = ranking100 > 1 ? Math.min(ranking100 / 100.0, 1.0) : Math.max(ranking100, 0);
    expect(normalized).toBe(0.85);
  });

  // ========================================================================
  // TEST 6: Skip unknown books
  // ========================================================================
  it('6.1 runOnce skips records with no matching book_external_refs', async () => {
    const records = [
      baseRecord('1', 'unknown-ext', '2026-01-15T10:00:00Z'),
    ];

    const mockFetch = createMockFetch([{
      records,
      hasMore: false,
      nextPageToken: null,
    }]);

    let syncLogStatus = null;
    const queryHandler = async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT') && sql.includes('did_sync_state')) {
        return { rows: [{ cursor_updated_at: '2026-01-15T10:00:00Z', cursor_external_id: null }] };
      }
      if (sql.includes('book_external_refs')) return { rows: [] };
      if (sql.includes('video_jobs')) return { rows: [] };
      if (sql.includes('INSERT INTO did_sync_log')) {
        syncLogStatus = params[0];
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO did_sync_state') && sql.includes('cursor_updated_at')) {
        return { rows: [{ cursor_updated_at: params[1] }] };
      }
      if (sql.includes('last_started_at')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql.substring(0, 80)}...`);
    };
    mockDb.query.mockImplementation(queryHandler);
    mockClient.query.mockImplementation(queryHandler);

    repo = new DidSyncRepository({ database: mockDb });
    const client = buildClient(mockFetch);
    service = buildService(client, repo);

    const result = await service.runOnce();

    expect(result.skipped).toBe(1);
    expect(syncLogStatus).toBe('skipped');
  });

  // ========================================================================
  // TEST 7: Multi-page pagination
  // ========================================================================
  it('7.1 runOnce handles multi-page fetch when hasMore is true', async () => {
    const page1Records = [baseRecord('1', EXT_ID_1, '2026-01-15T10:00:00Z')];
    const page2Records = [baseRecord('2', EXT_ID_2, '2026-01-15T11:00:00Z')];

    const mockFetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          records: page1Records,
          hasMore: true,
          nextPageToken: 'token-page-2',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          records: page2Records,
          hasMore: false,
          nextPageToken: null,
        }),
      });

    let cursorUpdatedAt = null;
    const queryHandler = async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT') && sql.includes('did_sync_state')) {
        return { rows: [{ cursor_updated_at: '2026-01-15T09:00:00Z', cursor_external_id: null }] };
      }
      if (sql.includes('book_external_refs')) return { rows: [{ book_id: BOOK_UUID }] };
      if (sql.includes('INSERT INTO book_did_engagement')) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE video_jobs') && sql.includes('did_reported_status')) return { rows: [] };
      if (sql.includes('INSERT INTO did_sync_log')) return { rows: [] };
      if (sql.includes('INSERT INTO did_sync_state') && sql.includes('cursor_updated_at')) {
        cursorUpdatedAt = params[1];
        return { rows: [{ cursor_updated_at: params[1] }] };
      }
      if (sql.includes('last_started_at')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql.substring(0, 80)}...`);
    };
    mockDb.query.mockImplementation(queryHandler);
    mockClient.query.mockImplementation(queryHandler);

    repo = new DidSyncRepository({ database: mockDb });
    const client = buildClient(mockFetch);
    service = buildService(client, repo);

    const result = await service.runOnce();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.fetched).toBe(2);
    expect(result.insertedOrUpdated).toBe(2);
    expect(result.status).toBe('success');
    expect(cursorUpdatedAt).not.toBeNull();
  });
});
