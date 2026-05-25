import { jest } from '@jest/globals';
import express from 'express';
import supertest from 'supertest';

const mockPool = { query: jest.fn() };

jest.unstable_mockModule('../../src/db/client.js', () => ({ default: mockPool }));

let app;

beforeAll(async () => {
  const mod = await import('../../src/api/metrics-routes.js');
  app = express();
  app.use(express.json());
  app.use(mod.default);
});

beforeEach(() => {
  mockPool.query.mockReset();
});

describe('Metrics Drift API', () => {
  it('computes drift metrics for default 7d period', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{
        sample_count: '200', ml_mean: '65.0', formula_mean: '68.0',
        ml_mae: '5.2', ml_rmse: '7.8', pearson_r: '0.85',
      }],
    });

    const res = await supertest(app).get('/metrics/drift');
    expect(res.status).toBe(200);
    expect(res.body.data.period).toBe('7d');
    expect(res.body.data.sample_count).toBe(200);
    expect(res.body.data.ml_r2).toBeCloseTo(0.7225);
    expect(res.body.data.winner).toBe('ml');
  });

  it('returns tie when sample_count < 100', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{
        sample_count: '50', ml_mean: '65.0', formula_mean: '68.0',
        ml_mae: '5.2', ml_rmse: '7.8', pearson_r: '0.85',
      }],
    });

    const res = await supertest(app).get('/metrics/drift?period=14');
    expect(res.body.data.winner).toBe('tie');
    expect(res.body.data.period).toBe('14d');
  });

  it('returns tie when pearson_r is null', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{
        sample_count: '200', ml_mean: null, formula_mean: null,
        ml_mae: null, ml_rmse: null, pearson_r: null,
      }],
    });

    const res = await supertest(app).get('/metrics/drift');
    expect(res.body.data.winner).toBe('tie');
    expect(res.body.data.ml_r2).toBeNull();
  });

  it('returns 500 on DB error', async () => {
    mockPool.query.mockRejectedValue(new Error('DB timeout'));

    const res = await supertest(app).get('/metrics/drift');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('DB timeout');
  });
});
