import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import pg from 'pg';
import { SyncEventsRepository } from '../../../src/sync/did/sync-events.repository.js';

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeWithDb = connectionString ? describe : describe.skip;

describeWithDb('Smart DID sync event batching', () => {
  let db;
  let events;

  beforeAll(() => {
    db = new Pool({ connectionString });
    events = new SyncEventsRepository({ database: db });
  });

  afterAll(async () => {
    await db.end();
  });

  test('getPendingEvents respects limit', async () => {
    const prefix = `test-page-${Date.now()}`;

    for (let i = 0; i < 5; i += 1) {
      await events.insertWebhookEvent({
        eventType: 'video.updated',
        bookId: `${prefix}-book-${i}`,
        idempotencyKey: `${prefix}-key-${i}`,
        payload: {},
      });
    }

    const result = await events.getPendingEvents({ limit: 2 });

    expect(result.length).toBeLessThanOrEqual(2);
  });
});