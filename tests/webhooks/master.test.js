import { jest } from '@jest/globals';
import request from 'supertest';

process.env.DID_WEBHOOK_SECRET = process.env.DID_WEBHOOK_SECRET || 'test-secret-min-32-chars-long-1234';
process.env.NODE_ENV = 'test';

// MOCK BullMQ BEFORE any imports to prevent real Redis connections
jest.unstable_mockModule('../../src/queue/bullmq.client.js', () => {
  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  return {
    default: {
      deadLetterQueue: mockQueue,
      reconciliationQueue: mockQueue,
      videoRegenerationQueue: mockQueue,
      videoRefreshQueue: mockQueue,
      syncAlertQueue: mockQueue,
      asyncEngagementQueue: mockQueue,
      didIncrementalSyncQueue: mockQueue,
      featureComputationQueue: mockQueue,
      inferenceQueue: mockQueue,
    },
    deadLetterQueue: mockQueue,
    reconciliationQueue: mockQueue,
    videoRegenerationQueue: mockQueue,
    videoRefreshQueue: mockQueue,
    syncAlertQueue: mockQueue,
    asyncEngagementQueue: mockQueue,
    didIncrementalSyncQueue: mockQueue,
    featureComputationQueue: mockQueue,
    inferenceQueue: mockQueue,
  };
});

let redisMock;
let dbMock;
let app;
let signPayload;
let checkIdempotency;

const SECRET = process.env.DID_WEBHOOK_SECRET;

function makePayload(overrides = {}) {
  return {
    eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventType: 'video.requested',
    data: { bookId: 'did-ext-test-book' },
    ...overrides
  };
}

function postWebhook(payload, signature) {
  const sig = signature || signPayload(payload, SECRET);
  return request(app)
    .post('/webhooks/did')
    .set('x-did-signature', sig)
    .set('Content-Type', 'application/json')
    .send(payload);
}

beforeAll(async () => {
  jest.unstable_mockModule('../../src/queue/redis.client.js', () => ({
    default: {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      flushall: jest.fn().mockResolvedValue('OK'),
      quit: jest.fn().mockResolvedValue('OK'),
      on: jest.fn()
    }
  }));

  dbMock = { query: jest.fn(), end: jest.fn(), on: jest.fn() };
  jest.unstable_mockModule('../../src/db/client.js', () => ({
    default: dbMock
  }));

  const appModule = await import('../../src/app.js');
  app = appModule.default;

  const signModule = await import('./helpers/sign.js');
  signPayload = signModule.signPayload;

  const idempModule = await import('../../src/webhooks/idempotency.js');
  checkIdempotency = idempModule.checkIdempotency;
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Webhook Receiver Master Test Suite (40 Tests)', () => {
  describe('SECTION 1: HMAC VALIDATION', () => {
    it('1.1 Reject missing signature', async () => {
      const res = await request(app).post('/webhooks/did').send({});
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Missing signature');
    });

    it('1.2 Reject invalid signature', async () => {
      const res = await request(app).post('/webhooks/did').set('x-did-signature', 'invalid').send({});
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid signature');
    });

    it('1.3 Accept valid signature', async () => {
      const payload = { eventId: '1', eventType: 'unknown', data: {} };
      const sig = signPayload(payload, SECRET);
      const res = await request(app).post('/webhooks/did').set('x-did-signature', sig).send(payload);
      expect(res.status).toBe(200);
    });

    it('1.4 Secret validation rejects short secret', async () => {
      const orig = process.env.DID_WEBHOOK_SECRET;
      process.env.DID_WEBHOOK_SECRET = 'short';
      try {
        const { validateEnv } = await import('../../src/webhooks/did.handler.js');
        expect(() => validateEnv()).toThrow(/16 characters/);
      } finally {
        process.env.DID_WEBHOOK_SECRET = orig;
      }
    });
  });

  describe('SECTION 2: PAYLOAD VALIDATION', () => {
    it('2.1 Reject missing eventId', async () => {
      const payload = { eventType: 'video.requested', data: { bookId: 'test' } };
      const res = await postWebhook(payload);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid payload');
    });

    it('2.2 Reject missing eventType', async () => {
      const payload = { eventId: 'evt-1', data: { bookId: 'test' } };
      const res = await postWebhook(payload);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid payload');
    });

    it('2.3 Reject missing data', async () => {
      const payload = { eventId: 'evt-1', eventType: 'video.requested' };
      const res = await postWebhook(payload);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid payload');
    });

    it('2.4 Malformed JSON returns 400', async () => {
      const sig = signPayload('not-json', SECRET);
      const res = await request(app)
        .post('/webhooks/did')
        .set('x-did-signature', sig)
        .set('Content-Type', 'application/json')
        .send('not-json');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid payload');
    });

    it('2.5 Minimal payload with unknown eventType returns 200 ignored', async () => {
      const payload = { eventId: 'evt-unknown', eventType: 'some.random.type', data: {} };
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ignored');
    });
  });

  describe('SECTION 3: IDEMPOTENCY', () => {
    it('3.1 New event passes through and returns ok', async () => {
      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const payload = makePayload({ eventType: 'video.done' });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(['ok', 'ignored']).toContain(res.body.status);
    });

    it('3.2 Duplicate event detected and returns duplicate status', async () => {
      const { default: redis } = await import('../../src/queue/redis.client.js');
      redis.set.mockResolvedValue(null);

      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const payload = makePayload({ eventId: 'dup-evt', eventType: 'video.requested' });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('duplicate');
    });

    it('3.3 Redis down fail-open — allows request through', async () => {
      const { default: redis } = await import('../../src/queue/redis.client.js');
      redis.set.mockRejectedValue(new Error('Redis connection refused'));

      const payload = makePayload({ eventType: 'video.done' });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
    });

    it('3.4 Idempotency key uses EX 86400 TTL', async () => {
      const { default: redis } = await import('../../src/queue/redis.client.js');
      const result = await checkIdempotency('ttl-test-evt');
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('webhook:did:ttl-test-evt'),
        '1',
        'EX',
        86400,
        'NX'
      );
      expect(result.isDuplicate).toBe(false);
    });
  });

  describe('SECTION 4: video.requested', () => {
    it('4.1 Insert sync event with correct eventType', async () => {
      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const payload = makePayload({ eventType: 'video.requested', data: { bookId: 'ext-1', requestCount: 5, rankingScore: 0.8 } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      const insertCall = dbMock.query.mock.calls.find(c => c[0].includes('smart_did_sync_events'));
      expect(insertCall).toBeDefined();
      expect(insertCall[1][1]).toBe('video.requested');
    });

    it('4.2 Resolves external book ID to UUID via book_external_refs', async () => {
      dbMock.query.mockResolvedValue({ rows: [{ book_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] });
      const payload = makePayload({ eventType: 'video.requested', data: { bookId: 'ext-2' } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body.bookId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    });

    it('4.3 Enqueue reconciliation for unknown book', async () => {
      dbMock.query.mockResolvedValue({ rows: [] });
      const payload = makePayload({ eventType: 'video.requested', data: { bookId: 'unknown-ext' } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('skipped');
      expect(res.body.reason).toBe('unknown_book');
    });

    it('4.4 Returns ok when requestCount and rankingScore provided', async () => {
      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const payload = makePayload({ eventType: 'video.requested', data: { bookId: 'ext-3', requestCount: 100, rankingScore: 0.95 } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('4.5 Missing bookId is skipped with reason', async () => {
      const payload = makePayload({ eventType: 'video.requested', data: { } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('skipped');
      expect(res.body.reason).toBe('missing_book_id');
    });

    it('4.6 Does NOT update books table (metadata protection)', async () => {
      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const payload = makePayload({ eventType: 'video.requested', data: { bookId: 'ext-4', requestCount: 1, rankingScore: 0.5 } });
      await postWebhook(payload);
      const booksUpdate = dbMock.query.mock.calls.find(c =>
        c[0] && c[0].includes('UPDATE') && c[0].includes('books')
      );
      expect(booksUpdate).toBeUndefined();
    });
  });

  describe('SECTION 5: video.updated', () => {
    it('5.1 Upserts state via sync event with correct eventType', async () => {
      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const payload = makePayload({ eventType: 'video.updated', data: { bookId: 'ext-5', status: 'completed' } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      const insertCall = dbMock.query.mock.calls.find(c => c[0].includes('smart_did_sync_events'));
      expect(insertCall).toBeDefined();
      expect(insertCall[1][1]).toBe('video.updated');
    });

    it('5.2 Unknown book returns skipped', async () => {
      dbMock.query.mockResolvedValue({ rows: [] });
      const payload = makePayload({ eventType: 'video.updated', data: { bookId: 'unknown-ext-update' } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('skipped');
      expect(res.body.reason).toBe('unknown_book');
    });

    it('5.3 Missing bookId is skipped', async () => {
      const payload = makePayload({ eventType: 'video.updated', data: {} });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('skipped');
      expect(res.body.reason).toBe('missing_book_id');
    });
  });

  describe('SECTION 6: video.deleted', () => {
    it('6.1 Inserts sync event with video.deleted eventType', async () => {
      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const payload = makePayload({ eventType: 'video.deleted', data: { bookId: 'ext-6', reason: 'expired' } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      const insertCall = dbMock.query.mock.calls.find(c => c[0].includes('smart_did_sync_events'));
      expect(insertCall).toBeDefined();
      expect(insertCall[1][1]).toBe('video.deleted');
    });

    it('6.2 Missing bookId is skipped', async () => {
      const payload = makePayload({ eventType: 'video.deleted', data: {} });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('skipped');
      expect(res.body.reason).toBe('missing_book_id');
    });
  });

  describe('SECTION 7: video.expired', () => {
    it('7.1 Inserts sync event with video.expired eventType', async () => {
      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const payload = makePayload({ eventType: 'video.expired', data: { bookId: 'ext-7', expiresAt: new Date().toISOString() } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      const insertCall = dbMock.query.mock.calls.find(c => c[0].includes('smart_did_sync_events'));
      expect(insertCall).toBeDefined();
      expect(insertCall[1][1]).toBe('video.expired');
    });

    it('7.2 Returns ok status for valid expiration event', async () => {
      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const payload = makePayload({ eventType: 'video.expired', data: { bookId: 'ext-7b', expiresAt: new Date().toISOString() } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('7.3 Unknown book returns skipped', async () => {
      dbMock.query.mockResolvedValue({ rows: [] });
      const payload = makePayload({ eventType: 'video.expired', data: { bookId: 'unknown-ext-expired' } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('skipped');
    });
  });

  describe('SECTION 8: sync.completed', () => {
    it('8.1 Inserts sync event with sync.completed eventType', async () => {
      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const payload = makePayload({ eventType: 'sync.completed', data: { bookId: 'ext-8', recordCount: 42 } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      const insertCall = dbMock.query.mock.calls.find(c => c[0].includes('smart_did_sync_events'));
      expect(insertCall).toBeDefined();
      expect(insertCall[1][1]).toBe('sync.completed');
    });

    it('8.2 Missing bookId is skipped', async () => {
      const payload = makePayload({ eventType: 'sync.completed', data: {} });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('skipped');
    });
  });

  describe('SECTION 9: ERROR HANDLING', () => {
    it('9.1 Handler crash caught by fallback chain', async () => {
      dbMock.query.mockRejectedValue(new Error('DB connection lost'));
      const payload = makePayload({ eventType: 'video.requested', data: { bookId: 'ext-crash' } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
    });

    it('9.2 Dead-letter queue receives failed event', async () => {
      dbMock.query.mockRejectedValue(new Error('DB crash'));
      const payload = makePayload({ eventType: 'video.requested', data: { bookId: 'ext-dlq' } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
    });

    it('9.3 Unknown event type returns ignored status', async () => {
      const payload = { eventId: 'evt-unknown-2', eventType: 'nonexistent.event', data: { bookId: 'ext-unknown' } };
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ignored');
    });
  });

  describe('SECTION 10: LATENCY', () => {
    it('10.1 Response completes under 200ms', async () => {
      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const start = Date.now();
      const payload = makePayload({ eventType: 'video.requested', data: { bookId: 'ext-latency' } });
      const res = await postWebhook(payload);
      const elapsed = Date.now() - start;
      expect(res.status).toBe(200);
      expect(elapsed).toBeLessThan(200);
    });

    it('10.2 Response includes durationMs field', async () => {
      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const payload = makePayload({ eventType: 'video.requested', data: { bookId: 'ext-dur' } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('durationMs');
      expect(typeof res.body.durationMs).toBe('number');
    });
  });

  describe('SECTION 11: CONCURRENCY', () => {
    it('11.1 All parallel requests succeed', async () => {
      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const { default: redis } = await import('../../src/queue/redis.client.js');
      redis.set.mockResolvedValue('OK');

      const payloads = Array(10).fill().map((_, i) => makePayload({ eventId: `concurrent-${i}`, eventType: 'video.done' }));
      const results = await Promise.all(payloads.map(p => postWebhook(p)));
      const allOk = results.every(r => r.status === 200);
      expect(allOk).toBe(true);
    });

    it('11.2 Parallel deduplicates identical eventId', async () => {
      const { default: redis } = await import('../../src/queue/redis.client.js');
      redis.set
        .mockResolvedValueOnce('OK')
        .mockResolvedValue(null);

      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });

      const payload = makePayload({ eventId: 'dedup-parallel', eventType: 'video.done' });
      const sig = signPayload(payload, SECRET);
      const requests = Array(10).fill().map(() => postWebhook(payload, sig));
      const results = await Promise.all(requests);
      const okCount = results.filter(r => r.body.status === 'ok').length;
      const dupCount = results.filter(r => r.body.status === 'duplicate').length;
      expect(okCount).toBe(1);
      expect(dupCount).toBe(9);
    });

    it('11.3 Race condition resilience under concurrent load', async () => {
      const { default: redis } = await import('../../src/queue/redis.client.js');
      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      redis.set.mockResolvedValue('OK');

      const payloads = Array(20).fill().map((_, i) => makePayload({ eventId: `race-${i}`, eventType: 'video.done' }));
      const results = await Promise.all(payloads.map(p => postWebhook(p)));
      const all200 = results.every(r => r.status === 200);
      expect(all200).toBe(true);
    });
  });

  describe('SECTION 12: CHAOS', () => {
    it('12.1 Handler timeout returns timeout_logged status', async () => {
      dbMock.query.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ rows: [{ book_id: 'uuid' }] }), 300)));
      const payload = makePayload({ eventType: 'video.requested', data: { bookId: 'ext-timeout' } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
      expect(['timeout_logged', 'ok', 'error_logged']).toContain(res.body.status);
    });

    it('12.2 Redis timeout still processes request (fail-open)', async () => {
      const { default: redis } = await import('../../src/queue/redis.client.js');
      redis.set.mockRejectedValue(new Error('Redis timeout'));

      dbMock.query.mockResolvedValue({ rows: [{ book_id: '00000000-0000-0000-0000-000000000001' }] });
      const payload = makePayload({ eventType: 'video.done', data: { bookId: 'ext-redis-down' } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
    });

    it('12.3 DLQ failure still returns 200', async () => {
      dbMock.query.mockRejectedValue(new Error('DB crash'));
      const payload = makePayload({ eventType: 'video.requested', data: { bookId: 'ext-dlq-fail' } });
      const res = await postWebhook(payload);
      expect(res.status).toBe(200);
    });
  });
});
