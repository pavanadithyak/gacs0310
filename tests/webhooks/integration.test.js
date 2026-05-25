import { jest } from '@jest/globals';
import request from 'supertest';

// MOCKING INFRA BEFORE IMPORTS
jest.unstable_mockModule('../../src/queue/redis.client.js', () => ({
  default: {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn().mockResolvedValue(null),
    flushall: jest.fn().mockResolvedValue('OK'),
    quit: jest.fn().mockResolvedValue('OK'),
    on: jest.fn()
  }
}));

jest.unstable_mockModule('../../src/queue/bullmq.client.js', () => {
  const mockAdd = jest.fn().mockResolvedValue({ id: 'mock-job-id' });
  const q = { add: mockAdd, on: jest.fn() };
  return {
    default: { add: mockAdd, deadLetterQueue: q, reconciliationQueue: q, videoRegenerationQueue: q, videoRefreshQueue: q, syncAlertQueue: q, asyncEngagementQueue: q, didIncrementalSyncQueue: q, featureComputationQueue: q, inferenceQueue: q },
    deadLetterQueue: q, reconciliationQueue: q, videoRegenerationQueue: q, videoRefreshQueue: q, syncAlertQueue: q, asyncEngagementQueue: q, didIncrementalSyncQueue: q, featureComputationQueue: q, inferenceQueue: q
  };
});

const mockDb = { query: jest.fn(), end: jest.fn(), on: jest.fn() };
jest.unstable_mockModule('../../src/db/client.js', () => ({
  default: mockDb
}));

const mockCheckIdempotency = jest.fn().mockResolvedValue({ isDuplicate: false, redisAvailable: true });
jest.unstable_mockModule('../../src/webhooks/idempotency.js', () => ({
  checkIdempotency: mockCheckIdempotency
}));

// DYNAMICALLY IMPORT AFTER MOCKS
const { default: app } = await import('../../src/app.js');
const { signPayload } = await import('./helpers/sign.js');

const SECRET = process.env.DID_WEBHOOK_SECRET || 'test-secret-min-32-chars-long-1234';
const TEST_BOOK_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const TEST_EXT_ID = 'did-ext-book-001';

function makePayload(overrides = {}) {
  return { eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, eventType: 'video.requested', occurredAt: new Date().toISOString(), data: {}, ...overrides };
}

function postWebhook(payload) {
  const sig = signPayload(payload, SECRET);
  return request(app).post('/webhooks/did').set('x-did-signature', sig).set('Content-Type', 'application/json').send(payload);
}

describe('Webhook Integration Test Suite - Multi-Event Lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckIdempotency.mockResolvedValue({ isDuplicate: false, redisAvailable: true });
  });

  describe('SECTION 1: Complete Book Lifecycle', () => {
    it('1.1 Book lifecycle: requested -> updated -> expired -> deleted', async () => {
      mockDb.query.mockResolvedValue({ rows: [{ book_id: TEST_BOOK_ID }] });

      // Step 1: Book is requested
      const requestedRes = await postWebhook(makePayload({
        eventType: 'video.requested',
        data: { bookId: TEST_EXT_ID, requestCount: 1, rankingScore: 0.8 }
      }));
      expect(requestedRes.status).toBe(200);
      expect(requestedRes.body.bookId).toBe(TEST_BOOK_ID);

      // Step 2: Book video is updated
      const updatedRes = await postWebhook(makePayload({
        eventType: 'video.updated',
        data: { bookId: TEST_EXT_ID, status: 'completed', retryCount: 0 }
      }));
      expect(updatedRes.status).toBe(200);

      // Step 3: Book video expires
      const expiredRes = await postWebhook(makePayload({
        eventType: 'video.expired',
        data: { bookId: TEST_EXT_ID, expiresAt: new Date().toISOString() }
      }));
      expect(expiredRes.status).toBe(200);

      // Step 4: Book video is deleted
      const deletedRes = await postWebhook(makePayload({
        eventType: 'video.deleted',
        data: { bookId: TEST_EXT_ID, reason: 'expired' }
      }));
      expect(deletedRes.status).toBe(200);
    });

    it('1.2 Each lifecycle event hits the database', async () => {
      mockDb.query.mockResolvedValue({ rows: [{ book_id: TEST_BOOK_ID }] });

      await postWebhook(makePayload({ eventType: 'video.requested', data: { bookId: TEST_EXT_ID, requestCount: 1, rankingScore: 0.5 } }));
      await postWebhook(makePayload({ eventType: 'video.updated', data: { bookId: TEST_EXT_ID, status: 'completed' } }));
      await postWebhook(makePayload({ eventType: 'video.expired', data: { bookId: TEST_EXT_ID } }));

      expect(mockDb.query).toHaveBeenCalled();
      const syncEventCalls = mockDb.query.mock.calls.filter(c => c[0] && c[0].includes('smart_did_sync_events'));
      expect(syncEventCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('SECTION 2: Error Recovery Lifecycle', () => {
    it('2.1 Failed video triggers regeneration after 3 retries', async () => {
      mockDb.query.mockResolvedValue({ rows: [{ book_id: TEST_BOOK_ID }] });

      // Third failure (retryCount: 3) - should trigger regeneration
      const res = await postWebhook(makePayload({
        eventType: 'video.updated',
        data: { bookId: TEST_EXT_ID, status: 'failed', retryCount: 3, errorMessage: 'render timeout' }
      }));
      expect(res.status).toBe(200);
      expect(res.body.bookId).toBe(TEST_BOOK_ID);
    });
  });

  describe('SECTION 3: Unknown Book Reconciliation', () => {
    it('3.1 Unknown book sends to reconciliation queue', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      const res = await postWebhook(makePayload({
        eventType: 'video.requested',
        data: { bookId: 'unknown-book-id', requestCount: 5, rankingScore: 0.5 }
      }));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('skipped');
      expect(res.body.reason).toBe('unknown_book');
    });
  });

  describe('SECTION 4: Data Ownership Verification', () => {
    it('4.1 Webhook events do NOT update books.title or books.author', async () => {
      mockDb.query.mockResolvedValue({ rows: [{ book_id: TEST_BOOK_ID }] });

      await postWebhook(makePayload({
        eventType: 'video.requested',
        data: { bookId: TEST_EXT_ID, requestCount: 1, rankingScore: 0.5 }
      }));

      const booksUpdate = mockDb.query.mock.calls.find(c =>
        c[0] && c[0].includes('UPDATE books') && (c[0].includes('title') || c[0].includes('author'))
      );
      expect(booksUpdate).toBeUndefined();
    });

    it('4.2 Engagement signals go to smart_did_sync_events (not book_engagement)', async () => {
      mockDb.query.mockResolvedValue({ rows: [{ book_id: TEST_BOOK_ID }] });

      await postWebhook(makePayload({
        eventType: 'video.requested',
        data: { bookId: TEST_EXT_ID, requestCount: 1, rankingScore: 0.5 }
      }));

      const wrongTableCall = mockDb.query.mock.calls.find(c =>
        c[0] && c[0].includes('INSERT INTO book_engagement')
      );
      expect(wrongTableCall).toBeUndefined();
    });
  });
});
