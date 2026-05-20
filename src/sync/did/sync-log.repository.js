import db from '../../db/client.js';

export class SyncLogRepository {
  constructor({ database = db } = {}) {
    this.db = database;
  }

  async log({
    bookId = null,
    externalBookId = null,
    eventType = null,
    syncType = 'drift_recovery',
    status,
    idempotencyKey = null,
    payload = {},
    errorMessage = null,
    attemptNumber = 1,
  }) {
    await this.db.query(
      `INSERT INTO did_sync_log (
         book_id,
         external_book_id,
         source_system,
         event_type,
         sync_type,
         status,
         idempotency_key,
         payload_json,
         error_message,
         attempt_number,
         synced_at
       )
       VALUES ($1, $2, 'smart_did', $3, $4, $5, $6, $7::jsonb, $8, $9, NOW())`,
      [
        bookId,
        externalBookId,
        eventType,
        syncType,
        status,
        idempotencyKey,
        JSON.stringify(payload),
        errorMessage,
        attemptNumber,
      ],
    );
  }
}