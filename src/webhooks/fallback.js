/**
 * Wrapper for event handlers that provides:
 * 1. Performance monitoring (latency logging)
 * 2. Crash resilience (catch and log to dead-letter queue)
 * 3. Consistent response structure
 */
export async function runWithFallback(eventType, handler, payload, db, queues) {
  const start = Date.now();
  try {
    const result = await handler(payload, db, queues);
    const durationMs = Date.now() - start;
    
    if (durationMs > 150) {
      console.warn(`[SLOW] ${eventType} handler took ${durationMs}ms (approaching 200ms limit)`);
    }
    
    return { ...result, durationMs };
  } catch (err) {
    console.error(`[Fallback] Handler crashed for ${eventType}:`, err.message);
    
    try {
      // Catch-all: Send failed event to dead-letter queue
      await queues.deadLetterQueue.add('failed-event', {
        eventId: payload.eventId,
        eventType,
        payload,
        error: err.message,
        failedAt: new Date().toISOString()
      });
      return { status: 'error_logged', eventId: payload.eventId };
    } catch (queueErr) {
      console.error(`[Fallback] Dead-letter queue failed:`, queueErr.message);
      return { status: 'fallback_logged', eventId: payload.eventId };
    }
  }
}
