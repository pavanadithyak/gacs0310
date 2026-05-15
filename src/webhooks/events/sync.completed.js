/**
 * Handle sync.completed event (system-wide event)
 */
export async function handle(payload, db, queue) {
  const { syncId, videosTotal, videosChanged, syncDurationMs, status, errorMessage } = payload.data;
  
  try {
    // 1. Log sync to did_sync_log
    const result = await db.query(
      `INSERT INTO did_sync_log 
       (sync_timestamp, videos_synced, videos_changed, sync_status, 
        error_message, sync_duration_ms, synced_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'webhook:sync.completed', NOW())
       RETURNING id`,
      [new Date(payload.occurredAt), videosTotal, videosChanged, status, errorMessage, syncDurationMs]
    );
    
    const logId = result.rows[0].id;
    
    // 2. If failed, enqueue alert
    if (status === 'failed') {
      await queue.add('sync-alert', {
        syncId,
        errorMessage,
        occurredAt: payload.occurredAt
      });
    }
    
    return { status: 'ok', logId, enqueued: status === 'failed' ? ['sync-alert'] : [] };
  } catch (err) {
    console.error(`[sync.completed] error: ${err.message}`);
    return { status: 'error_logged' };
  }
}
