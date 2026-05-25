import { jest } from '@jest/globals';
import express from 'express';
import supertest from 'supertest';

const mockPool = { query: jest.fn() };

jest.unstable_mockModule('../../src/db/client.js', () => ({ default: mockPool }));
jest.unstable_mockModule('../../src/middleware/api-key-auth.js', () => ({
  apiKeyAuth: (req, res, next) => next(),
}));
jest.unstable_mockModule('../../src/queue/bullmq.client.js', () => ({
  featureComputationQueue: { add: jest.fn() },
}));

let app;

beforeAll(async () => {
  const mod = await import('../../src/api/inference-routes.js');
  app = express();
  app.use(express.json());
  app.use(mod.default);
});

beforeEach(() => {
  mockPool.query.mockReset();
});

describe('Predictions API', () => {
  it('returns prediction data for a known book', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{
        book_id: 'uuid-1',
        model_version: '0.1.0',
        predicted_priority_score: '75.50000',
        formula_score: '70.0000',
        inference_timestamp: '2026-05-25T12:00:00Z',
        feature_vector_id: 42,
      }],
    });

    const res = await supertest(app).get('/predictions/uuid-1');
    expect(res.status).toBe(200);
    expect(res.body.data.book_id).toBe('uuid-1');
    expect(res.body.data.prediction_score).toBe(75.5);
    expect(res.body.data.formula_score).toBe(70);
    expect(res.body.data.variance).toBe(5.5);
  });

  it('returns 404 when no prediction exists', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const res = await supertest(app).get('/predictions/uuid-missing');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No prediction');
  });

  it('handles null formula_score gracefully', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{
        book_id: 'uuid-2', model_version: '0.1.0',
        predicted_priority_score: '50.00000', formula_score: null,
        inference_timestamp: '2026-05-25T12:00:00Z', feature_vector_id: 43,
      }],
    });

    const res = await supertest(app).get('/predictions/uuid-2');
    expect(res.status).toBe(200);
    expect(res.body.data.formula_score).toBeNull();
    expect(res.body.data.variance).toBeNull();
  });

  it('returns 500 on DB error', async () => {
    mockPool.query.mockRejectedValue(new Error('DB connection lost'));

    const res = await supertest(app).get('/predictions/uuid-1');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('DB connection lost');
  });
});
