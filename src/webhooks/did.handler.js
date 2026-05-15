import crypto from 'crypto';
import db from '../db/client.js';
import queues from '../queue/bullmq.client.js';
import { runWithFallback } from './fallback.js';
import { checkIdempotency } from './idempotency.js';

const HANDLER_TIMEOUT_MS = 180;

/**
 * Startup validation for DID_WEBHOOK_SECRET
 */
export function validateEnv() {
  if (!process.env.DID_WEBHOOK_SECRET || process.env.DID_WEBHOOK_SECRET.length < 16) {
    throw new Error('[FATAL] DID_WEBHOOK_SECRET must be set and >= 16 characters');
  }
}

/**
 * Main webhook handler for POST /webhooks/did
 * Includes HMAC validation, Idempotency, Timeout Guard, and Fallback Chain.
 */
export async function handleWebhook(req, res) {
  const startTime = Date.now();
  const rawBody = req.body; // Expect Buffer from express.raw()
  
  // 1. HMAC Validation
  const signature = req.headers['x-did-signature'];
  if (!signature) {
    console.error(`[${Date.now()}] webhook:auth_error Missing signature`);
    return res.status(401).json({ error: 'Missing signature', eventId: null });
  }

  try {
    const computed = crypto
      .createHmac('sha256', process.env.DID_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))) {
      console.error(`[${Date.now()}] webhook:auth_error Invalid signature`);
      return res.status(401).json({ error: 'Invalid signature', eventId: null });
    }
  } catch (err) {
    console.error(`[${Date.now()}] webhook:auth_error Validation failed: ${err.message}`);
    return res.status(401).json({ error: 'Invalid signature', eventId: null });
  }

  // 2. Payload Parsing
  let payload;
  try {
    payload = JSON.parse(rawBody.toString());
  } catch (err) {
    console.error(`[${Date.now()}] webhook:parse_error Invalid JSON`);
    return res.status(400).json({ error: 'Invalid payload', details: 'JSON parse failed' });
  }

  const { eventId, eventType, data } = payload;

  // 3. Payload Validation
  if (!eventId || !eventType || !data) {
    console.error(`[${Date.now()}] webhook:validation_error Missing fields`);
    return res.status(400).json({ error: 'Invalid payload', details: 'Missing eventId, eventType, or data' });
  }

  // 4. Check Idempotency
  const { isDuplicate } = await checkIdempotency(eventId);
  if (isDuplicate) {
    console.log(`[webhook] eventId=${eventId} status=duplicate`);
    return res.status(200).json({
      status: 'duplicate',
      eventId,
      reason: 'Event already processed within 24 hours'
    });
  }

  // 5. Get Handler for event type
  let handler;
  try {
    switch (eventType) {
      case 'video.requested':
        handler = (await import('./events/video.requested.js')).handle;
        break;
      case 'video.updated':
        handler = (await import('./events/video.updated.js')).handle;
        break;
      case 'video.deleted':
        handler = (await import('./events/video.deleted.js')).handle;
        break;
      case 'video.expired':
        handler = (await import('./events/video.expired.js')).handle;
        break;
      case 'sync.completed':
        handler = (await import('./events/sync.completed.js')).handle;
        break;
      default:
        console.warn(`[${Date.now()}] webhook:ignored Unknown eventType: ${eventType}`);
        return res.status(200).json({ status: 'ignored', eventId });
    }
  } catch (err) {
    console.error(`[webhook] Failed to load handler for ${eventType}:`, err.message);
    return res.status(200).json({ status: 'error_logged', eventId });
  }

  // 6. Run Handler with Timeout + Fallback
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Handler timeout')), HANDLER_TIMEOUT_MS)
    );
    
    const result = await Promise.race([
      runWithFallback(eventType, handler, payload, db, queues),
      timeoutPromise
    ]);
    
    const durationMs = Date.now() - startTime;
    return res.status(200).json({
      ...result,
      eventId,
      durationMs
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    if (err.message === 'Handler timeout') {
      console.warn(`[Timeout] ${eventType} exceeded ${HANDLER_TIMEOUT_MS}ms`);
      return res.status(200).json({
        status: 'timeout_logged',
        eventId,
        durationMs
      });
    } else {
      console.error(`[${Date.now()}] webhook:error eventId=${eventId} error=${err.message} durationMs=${durationMs}`);
      return res.status(200).json({ status: 'error_logged', eventId, durationMs });
    }
  }
}
