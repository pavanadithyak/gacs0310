import { Worker } from 'bullmq';
import redis from '../../queue/redis.client.js';
import { DidIncrementalSyncService } from './incremental-sync.service.js';

export const QUEUE_NAME = process.env.DID_SYNC_QUEUE_NAME || 'did-incremental-sync';

export function buildDidIncrementalSyncWorker() {
  return new Worker(
    QUEUE_NAME,
    async () => {
      const service = new DidIncrementalSyncService();
      return service.runOnce();
    },
    {
      connection: redis,
      concurrency: Number(process.env.DID_SYNC_WORKER_CONCURRENCY || 1),
      lockDuration: Number(process.env.DID_SYNC_LOCK_TTL_MS || 840000),
    },
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const worker = buildDidIncrementalSyncWorker();

  worker.on('completed', (_job, result) => {
    console.log('[did-sync] completed', result);
  });

  worker.on('failed', (job, error) => {
    console.error('[did-sync] failed', {
      jobId: job?.id,
      error: error.message,
    });
  });
}