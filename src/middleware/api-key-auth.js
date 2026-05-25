export function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const expected = process.env.INFERENCE_API_KEY;

  if (!expected) {
    console.error('[auth] INFERENCE_API_KEY not configured');
    return res.status(500).json({ status: 'error', error: 'Server configuration error' });
  }

  if (!apiKey || apiKey !== expected) {
    return res.status(401).json({ status: 'error', error: 'Unauthorized' });
  }

  next();
}
