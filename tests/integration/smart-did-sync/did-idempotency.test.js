import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeWithDb = connectionString ? describe : describe.skip;

describeWithDb('Smart DID sync idempotency', () => {
  let db;

  beforeAll(() => {
    db = new Pool({ connectionString });
  });

  afterAll(async () => {
    await db.end();
  });

  test('duplicate webhook idempotency key only creates one inbox row', async () => {
    const key = `test-idem-${Date.now()}`;

    await db.query(
      `INSERT INTO smart_did_sync_events (event_type, book_id, idempotency_key, payload_json)
       VALUES ('video.updated', 'test-book-1', $1, '{}'::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [key],
    );

    await db.query(
      `INSERT INTO smart_did_sync_events (event_type, book_id, idempotency_key, payload_json)
       VALUES ('video.updated', 'test-book-1', $1, '{}'::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [key],
    );

    const result = await db.query(
      `SELECT COUNT(*)::int AS count
         FROM smart_did_sync_events
        WHERE idempotency_key = $1`,
      [key],
    );

    expect(result.rows[0].count).toBe(1);
  });
});