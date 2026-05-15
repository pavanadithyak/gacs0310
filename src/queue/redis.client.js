import Redis from 'ioredis';

/**
 * Redis client singleton with retry strategy
 */
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: false
});

redis.on('error', (err) => console.error('[Redis] Connection error:', err.message));
redis.on('connect', () => console.log('[Redis] Connected'));

export default redis;
