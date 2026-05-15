import crypto from 'crypto';

/**
 * Signs a payload with the given secret using HMAC-SHA256
 */
export function signPayload(body, secret) {
  if (typeof body !== 'string') {
    body = JSON.stringify(body);
  }
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}
