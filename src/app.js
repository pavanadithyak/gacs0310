import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import redis from './queue/redis.client.js';
import pool from './db/client.js';
import webhookRouter from './webhooks/index.js';
import { validateEnv } from './webhooks/did.handler.js';
import { buildSyncEventWorker } from './sync/did/sync-event.worker.js';
import { featuresRouter, buildFeatureComputationWorker } from './features/index.js';
import { buildInferenceWorker } from './ml/inference.worker.js';
import { inferenceRouter, metricsRouter } from './api/index.js';

try {
  validateEnv();
  console.log('[Startup] Environment validation passed');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const app = express();
const port = process.env.WEBHOOK_PORT || 3000;

app.use(morgan('combined'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRouter);
app.use(express.json());

app.use('/api/features', featuresRouter);
app.use('/api', inferenceRouter);
app.use('/api', metricsRouter);

let server;
const activeWorkers = [];

async function shutdown(signal) {
  console.log(`[Shutdown] ${signal} received — draining resources...`);
  const start = Date.now();

  if (server) {
    server.close();
  }

  await Promise.allSettled(activeWorkers.map(w => w.close()));
  await redis.quit();
  await pool.end();

  const elapsed = Date.now() - start;
  console.log(`[Shutdown] Completed in ${elapsed}ms`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (process.env.NODE_ENV !== 'test') {
  server = app.listen(port, () => {
    console.log(`[Server] Webhook receiver listening on port ${port}`);
  });

  if (process.env.SYNC_WORKER_ENABLED === 'true') {
    const worker = buildSyncEventWorker();
    activeWorkers.push(worker);
    console.log('[Startup] Sync event worker started');
  }

  if (process.env.FEATURE_WORKER_ENABLED === 'true') {
    const worker = buildFeatureComputationWorker();
    activeWorkers.push(worker);
    console.log('[Startup] Feature computation worker started');
  }

  if (process.env.INFERENCE_WORKER_ENABLED === 'true') {
    const worker = buildInferenceWorker();
    activeWorkers.push(worker);
    console.log('[Startup] ML inference worker started');
  }
}

export default app;
