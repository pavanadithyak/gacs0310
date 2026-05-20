import crypto from 'node:crypto';
import redis from '../../queue/redis.client.js';

export class SyncLockService {
  constructor({ redisClient = redis } = {}) {
    this.redis = redisClient;
  }

  async acquireBookLock(bookId, ttlMs = Number(process.env.DID_SYNC_LOCK_TTL_MS || 840000)) {
    const key = `sync:smartdid:book:${bookId}`;
    const token = crypto.randomUUID();

    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');

    if (result !== 'OK') {
      return { acquired: false, key, token: null };
    }

    return { acquired: true, key, token };
  }

  async releaseLock(key, token) {
    if (!key || !token) return false;

    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;

    const result = await this.redis.eval(script, 1, key, token);
    return result === 1;
  }
}