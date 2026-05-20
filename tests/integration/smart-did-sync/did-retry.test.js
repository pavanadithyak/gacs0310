import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import pg from 'pg';
import { SyncEventsRepository } from '../../../src/sync/did/sync-events.repository.js';

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeWithDb = connectionString ? describe : describe.skip;

describeWithDb('Smart DID sync retry behavior', () => {
  let db;
  let events;

  beforeAll(() => {
    db = new Pool({ connectionString });
    events = new SyncEventsRepository({ database: db });
  });

  afterAll(async () => {
    await db.end();
  });

  test('failed event moves to retry and increments retry_count', async () => {
    const key = `test-retry-${Date.now()}`;

    await events.insertWebhookEvent({
      eventType: 'video.updated',
      bookId: 'test-retry-book',
      idempotencyKey: key,
      payload: { bookId: 'test-retry-book' },
    });

    const inserted = await db.query(
      `SELECT id FROM smart_did_sync_events WHERE idempotency_key = $1`,
      [key],
    );

    await events.markFailed(inserted.rows[0].id, new Error('fetch failed'));

    const result = await db.query(
      `SELECT status, retry_count, last_error
         FROM smart_did_sync_events
        WHERE idempotency_key = $1`,
      [key],
    );

    expect(result.rows[0].status).toBe('retry');
    expect(result.rows[0].retry_count).toBe(1);
    expect(result.rows[0].last_error).toBe('fetch failed');
  });
});