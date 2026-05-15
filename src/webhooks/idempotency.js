import redis from '../queue/redis.client.js';

/**
 * Checks if an event has already been processed using Redis SET NX.
 * Fail-open policy: allows the request if Redis is down.
 */
export async function checkIdempotency(eventId) {
  try {
    // SET NX: only set if key doesn't exist
    // TTL: 86400 seconds (24 hours)
    const result = await redis.set(`webhook:did:${eventId}`, '1', 'EX', 86400, 'NX');
    
    return {
      isDuplicate: result === null,  // null = key exists (duplicate)
      redisAvailable: true
    };
  } catch (err) {
    // Fail open: if Redis is down, allow request through
    console.error('[Idempotency] Redis error (failing open):', err.message);
    return {
      isDuplicate: false,  // assume new, don't block
      redisAvailable: false
    };
  }
}
