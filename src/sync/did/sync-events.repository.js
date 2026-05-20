import db from '../../db/client.js';

export class SyncEventsRepository {
  constructor({ database = db } = {}) {
    this.db = database;
  }

  async insertWebhookEvent({ eventType, bookId, idempotencyKey, payload }) {
    await this.db.query(
      `INSERT INTO smart_did_sync_events (
         event_type,
         book_id,
         idempotency_key,
         payload_json,
         status,
         received_at,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4::jsonb, 'pending', NOW(), NOW(), NOW())
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [eventType, bookId, idempotencyKey, JSON.stringify(payload || {})],
    );
  }

  async getPendingEvents({ limit = 100 } = {}) {
    const result = await this.db.query(
      `SELECT id, event_type, book_id, idempotency_key, payload_json, retry_count
         FROM smart_did_sync_events
        WHERE status IN ('pending', 'retry')
        ORDER BY received_at ASC
        LIMIT $1`,
      [limit],
    );

    return result.rows;
  }

  async markProcessing(eventId) {
    await this.db.query(
      `UPDATE smart_did_sync_events
          SET status = 'processing',
              updated_at = NOW()
        WHERE id = $1`,
      [eventId],
    );
  }

  async markProcessed(eventId) {
    await this.db.query(
      `UPDATE smart_did_sync_events
          SET status = 'processed',
              processed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [eventId],
    );
  }

  async markFailed(eventId, error) {
    await this.db.query(
      `UPDATE smart_did_sync_events
          SET status = CASE WHEN retry_count + 1 >= 5 THEN 'failed' ELSE 'retry' END,
              retry_count = retry_count + 1,
              last_error = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [eventId, error.message || String(error)],
    );
  }
}