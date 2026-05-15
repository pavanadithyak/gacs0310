import { jest } from '@jest/globals';

// MOCK BullMQ and Redis BEFORE imports
jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), close: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() }))
}));

jest.unstable_mockModule('../../src/queue/redis.client.js', () => ({
  default: { on: jest.fn(), quit: jest.fn() }
}));

// IMPORTS
const { mapSmartDIDVideoRecord, mapSmartDIDVideoRecords, buildCursorFromRecords } = await import('../../src/sync/did/did-sync.mapper.js');
const { DidSyncRepository } = await import('../../src/sync/did/did-sync.repository.js');
const { SmartDIDClient } = await import('../../src/integrations/smart-did.client.js');

describe('DID Sync Stack Unit Tests', () => {
  describe('SECTION 1: Mapper', () => {
    it('1.1 mapSmartDIDVideoRecord extracts all fields', () => {
      const raw = {
        bookId: 'ext-1',
        updatedAt: '2026-01-01T00:00:00Z',
        requestCount: 5,
        rankingScore: 0.9,
        lastRequestedAt: '2026-01-01T00:00:00Z',
        retryCount: 0,
        status: 'active'
      };
      const result = mapSmartDIDVideoRecord(raw);
      expect(result.externalBookId).toBe('ext-1');
      expect(result.requestCount).toBe(5);
      expect(result.rankingScore).toBe(0.9);
      expect(result.retryCount).toBe(0);
      expect(result.status).toBe('active');
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('1.2 mapSmartDIDVideoRecord throws on missing bookId', () => {
      expect(() => mapSmartDIDVideoRecord({ updatedAt: '2026-01-01' })).toThrow('missing bookId');
    });

    it('1.3 mapSmartDIDVideoRecord throws on missing updatedAt', () => {
      expect(() => mapSmartDIDVideoRecord({ bookId: 'ext-1' })).toThrow('missing updatedAt');
    });

    it('1.4 mapSmartDIDVideoRecord handles snake_case input', () => {
      const raw = {
        book_id: 'ext-2',
        updated_at: '2026-01-01T00:00:00Z',
        request_count: 3,
        ranking_score: 0.7
      };
      const result = mapSmartDIDVideoRecord(raw);
      expect(result.externalBookId).toBe('ext-2');
      expect(result.requestCount).toBe(3);
      expect(result.rankingScore).toBe(0.7);
    });

    it('1.5 mapSmartDIDVideoRecords maps array', () => {
      const records = [
        { bookId: 'ext-1', updatedAt: '2026-01-01T00:00:00Z', requestCount: 5 },
        { bookId: 'ext-2', updatedAt: '2026-01-02T00:00:00Z', requestCount: 10 }
      ];
      const result = mapSmartDIDVideoRecords(records);
      expect(result).toHaveLength(2);
      expect(result[0].externalBookId).toBe('ext-1');
      expect(result[1].externalBookId).toBe('ext-2');
    });

    it('1.6 buildCursorFromRecords returns latest by updatedAt', () => {
      const records = [
        mapSmartDIDVideoRecord({ bookId: 'ext-1', updatedAt: '2026-01-01T00:00:00Z' }),
        mapSmartDIDVideoRecord({ bookId: 'ext-2', updatedAt: '2026-01-02T00:00:00Z' })
      ];
      const cursor = buildCursorFromRecords(records);
      expect(cursor.cursorExternalId).toBe('ext-2');
      expect(cursor.cursorUpdatedAt.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    });

    it('1.7 buildCursorFromRecords uses bookId as tiebreaker', () => {
      const records = [
        mapSmartDIDVideoRecord({ bookId: 'ext-a', updatedAt: '2026-01-01T00:00:00Z' }),
        mapSmartDIDVideoRecord({ bookId: 'ext-b', updatedAt: '2026-01-01T00:00:00Z' })
      ];
      const cursor = buildCursorFromRecords(records);
      expect(cursor.cursorExternalId).toBe('ext-b');
    });

    it('1.8 buildCursorFromRecords returns null for empty array', () => {
      expect(buildCursorFromRecords([])).toBeNull();
    });

    it('1.9 mapSmartDIDVideoRecord defaults missing numeric fields to 0', () => {
      const raw = { bookId: 'ext-1', updatedAt: '2026-01-01T00:00:00Z' };
      const result = mapSmartDIDVideoRecord(raw);
      expect(result.requestCount).toBe(0);
      expect(result.rankingScore).toBe(0);
      expect(result.retryCount).toBe(0);
    });
  });

  describe('SECTION 2: Repository', () => {
    let mockDb;
    let repo;

    beforeEach(() => {
      mockDb = { query: jest.fn(), connect: jest.fn() };
      repo = new DidSyncRepository({ database: mockDb });
    });

    it('2.1 getCursor returns cursor state', async () => {
      mockDb.query.mockResolvedValue({ rows: [{ cursor_external_id: 'cursor-1', cursor_updated_at: '2026-01-01' }] });
      const result = await repo.getCursor();
      expect(result.cursor_external_id).toBe('cursor-1');
      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('did_sync_state'), ['smart_did.video_records']);
    });

    it('2.2 getCursor returns null when no state exists', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      const result = await repo.getCursor();
      expect(result).toBeNull();
    });

    it('2.3 markStarted records sync start', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      await repo.markStarted();
      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('last_started_at'), ['smart_did.video_records']);
    });

    it('2.4 markFailed stores error message', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });
      await repo.markFailed(new Error('API timeout'));
      expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('last_error'), ['smart_did.video_records', 'API timeout']);
    });

    it('2.5 resolveBookId returns book_id from book_external_refs', async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [{ book_id: 'uuid-1' }] }) };
      const result = await repo.resolveBookId(mockClient, 'ext-1');
      expect(result).toBe('uuid-1');
      expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('book_external_refs'), ['ext-1']);
    });

    it('2.6 resolveBookId falls back to video_jobs', async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ book_id: 'uuid-2' }] })
      };
      const result = await repo.resolveBookId(mockClient, 'ext-1');
      expect(result).toBe('uuid-2');
      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(mockClient.query.mock.calls[1][0]).toContain('video_jobs');
    });

    it('2.7 resolveBookId returns null when not found anywhere', async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] })
      };
      const result = await repo.resolveBookId(mockClient, 'unknown');
      expect(result).toBeNull();
    });
  });

  describe('SECTION 3: SmartDIDClient', () => {
    let client;
    let mockFetch;

    beforeEach(() => {
      mockFetch = jest.fn();
      client = new SmartDIDClient({
        baseUrl: 'https://did.example.com',
        apiToken: 'test-api-key',
        fetchImpl: mockFetch,
        timeoutMs: 5000
      });
    });

    it('3.1 fetchUpdatedVideoRecords makes correct API call', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          records: [{ bookId: 'ext-1', updatedAt: '2026-01-01' }],
          nextPageToken: 'token-2',
          hasMore: true
        })
      });
      const result = await client.fetchUpdatedVideoRecords({
        updatedAfter: new Date('2026-01-01'),
        limit: 100
      });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ 'Authorization': 'Bearer test-api-key' })
        })
      );
      expect(result.records).toHaveLength(1);
      expect(result.nextPageToken).toBe('token-2');
      expect(result.hasMore).toBe(true);
    });

    it('3.2 fetchUpdatedVideoRecords includes updatedAfter param', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ records: [], hasMore: false })
      });
      await client.fetchUpdatedVideoRecords({
        updatedAfter: new Date('2026-06-01T00:00:00Z'),
        limit: 50
      });
      const url = mockFetch.mock.calls[0][0];
      expect(url.searchParams.get('updatedAfter')).toBe('2026-06-01T00:00:00.000Z');
    });

    it('3.3 fetchUpdatedVideoRecords throws on API error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });
      await expect(client.fetchUpdatedVideoRecords({ limit: 100 })).rejects.toThrow('status 500');
    });
  });
});
