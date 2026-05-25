import { jest } from '@jest/globals';

const OLD_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...OLD_ENV };
});

afterAll(() => {
  process.env = OLD_ENV;
});

function buildReqRes(overrides = {}) {
  const req = { headers: {}, ...overrides };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return { req, res, next };
}

describe('apiKeyAuth middleware', () => {
  it('calls next() when X-API-Key matches INFERENCE_API_KEY', async () => {
    process.env.INFERENCE_API_KEY = 'test-key-123';
    const { apiKeyAuth } = await import('../../src/middleware/api-key-auth.js');

    const { req, res, next } = buildReqRes({ headers: { 'x-api-key': 'test-key-123' } });
    apiKeyAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when X-API-Key is missing', async () => {
    process.env.INFERENCE_API_KEY = 'test-key-123';
    const { apiKeyAuth } = await import('../../src/middleware/api-key-auth.js');

    const { req, res, next } = buildReqRes({ headers: {} });
    apiKeyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].error).toContain('Unauthorized');
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when X-API-Key is wrong', async () => {
    process.env.INFERENCE_API_KEY = 'test-key-123';
    const { apiKeyAuth } = await import('../../src/middleware/api-key-auth.js');

    const { req, res, next } = buildReqRes({ headers: { 'x-api-key': 'wrong-key' } });
    apiKeyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 500 when INFERENCE_API_KEY is not configured', async () => {
    delete process.env.INFERENCE_API_KEY;
    const { apiKeyAuth } = await import('../../src/middleware/api-key-auth.js');

    const { req, res, next } = buildReqRes({ headers: { 'x-api-key': 'any-key' } });
    apiKeyAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].error).toContain('Server configuration error');
    expect(next).not.toHaveBeenCalled();
  });
});
