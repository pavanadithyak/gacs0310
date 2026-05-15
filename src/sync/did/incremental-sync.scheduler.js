import { didIncrementalSyncQueue } from '../../queue/bullmq.client.js';

export const REPEATABLE_JOB_NAME = 'did.incremental-sync.every-15-minutes';

export async function scheduleDidIncrementalSync({
  enabled = String(process.env.DID_SYNC_ENABLED || 'false') === 'true',
  intervalMs = Number(process.env.DID_SYNC_INTERVAL_MS || 900000),
} = {}) {
  if (!enabled) {
    return {
      status: 'disabled',
      queueName: process.env.DID_SYNC_QUEUE_NAME || 'did-incremental-sync',
    };
  }

  await didIncrementalSyncQueue.add(
    REPEATABLE_JOB_NAME,
    {},
    {
      jobId: REPEATABLE_JOB_NAME,
      repeat: { every: intervalMs },
      attempts: Number(process.env.DID_SYNC_JOB_ATTEMPTS || 3),
      backoff: {
        type: 'exponential',
        delay: Number(process.env.DID_SYNC_JOB_BACKOFF_MS || 30000),
      },
      removeOnComplete: 25,
      removeOnFail: 100,
    },
  );

  return {
    status: 'scheduled',
    queueName: process.env.DID_SYNC_QUEUE_NAME || 'did-incremental-sync',
    every: intervalMs,
  };
}
