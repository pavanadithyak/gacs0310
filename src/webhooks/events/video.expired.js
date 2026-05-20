export async function handle(payload, db) {
  return insertSyncEvent(payload, db, 'video.expired');
}

async function insertSyncEvent(payload, db, fallbackEventType) {
  const eventType = payload.event_type || payload.eventType || fallbackEventType;
  const bookId = payload.book_id || payload.bookId || payload.data?.bookId;
  const idempotencyKey =
    payload.idempotency_key || payload.idempotencyKey || payload.eventId;

  if (!bookId) return { status: 'skipped', reason: 'missing_book_id' };
  if (!idempotencyKey) {
    return { status: 'skipped', reason: 'missing_idempotency_key' };
  }

  await db.query(
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
     ON CONFLICT (idempotency_key)
     DO NOTHING`,
    [eventType, bookId, idempotencyKey, JSON.stringify(payload)],
  );

  await db.query(
    `INSERT INTO did_sync_log (
       external_book_id,
       source_system,
       sync_type,
       status,
       idempotency_key,
       payload_json,
       synced_at
     )
     VALUES ($1, 'smart_did', 'webhook_inbox', 'success', $2, $3::jsonb, NOW())
     ON CONFLICT (idempotency_key)
     DO NOTHING`,
    [
      bookId,
      `webhook:${idempotencyKey}`,
      JSON.stringify({
        action: 'webhook_received',
        eventType,
        payload,
      }),
    ],
  );

  return {
    status: 'ok',
    bookId,
    queuedForSync: true,
  };
}
