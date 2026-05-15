import { Queue } from 'bullmq';
import redis from './redis.client.js';

/**
 * BullMQ Queue instances
 * Reuses the singleton Redis connection
 */

const queueOptions = { connection: redis };

export const deadLetterQueue = new Queue('dead-letter', queueOptions);
export const reconciliationQueue = new Queue('reconciliation', queueOptions);
export const videoRegenerationQueue = new Queue('video-regeneration', queueOptions);
export const videoRefreshQueue = new Queue('video-refresh', queueOptions);
export const syncAlertQueue = new Queue('sync-alert', queueOptions);
export const asyncEngagementQueue = new Queue('async-engagement', queueOptions);

export const didIncrementalSyncQueue = new Queue(
  process.env.DID_SYNC_QUEUE_NAME || 'did-incremental-sync',
  queueOptions,
);

const queues = {
  deadLetterQueue,
  reconciliationQueue,
  videoRegenerationQueue,
  videoRefreshQueue,
  syncAlertQueue,
  asyncEngagementQueue,
  didIncrementalSyncQueue,
};

for (const [name, queue] of Object.entries(queues)) {
  queue.on('error', (err) => {
    console.error(`[${name}] Queue error:`, err.message);
  });
}

export default queues;
