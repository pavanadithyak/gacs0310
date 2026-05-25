import { jest } from '@jest/globals';
import express from 'express';
import supertest from 'supertest';

const mockPool = { query: jest.fn() };
const mockQueue = { add: jest.fn() };

jest.unstable_mockModule('../../src/db/client.js', () => ({ default: mockPool }));
jest.unstable_mockModule('../../src/queue/bullmq.client.js', () => ({
  featureComputationQueue: mockQueue,
}));
jest.unstable_mockModule('../../src/middleware/api-key-auth.js', () => ({
  apiKeyAuth: (req, res, next) => next(),
}));

let predictionsRouter, metricsRouter;

beforeAll(async () => {
  const [predictions, metrics] = await Promise.all([
    import('../../src/api/inference-routes.js'),
    import('../../src/api/metrics-routes.js'),
  ]);
  predictionsRouter = predictions.default;
  metricsRouter = metrics.default;
});

beforeEach(() => {
  mockPool.query.mockReset();
  mockQueue.add.mockReset();
});

function createApp(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  return supertest(app);
}

describe('A/B Experiment Full Flow', () => {
  it('full cycle: features computed -> predictions recorded -> drift metrics show winner', async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          book_id: 'ab-uuid', model_version: '0.1.0',
          predicted_priority_score: '80.00000', formula_score: '60.0000',
          inference_timestamp: '2026-05-25T12:00:00Z', feature_vector_id: 100,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          sample_count: '150', ml_mean: '78.0', formula_mean: '62.0',
          ml_mae: '3.2', ml_rmse: '4.1', pearson_r: '0.91',
        }],
      });

    const predRes = await createApp(predictionsRouter).get('/predictions/ab-uuid');
    expect(predRes.body.data.prediction_score).toBe(80);
    expect(predRes.body.data.formula_score).toBe(60);
    expect(predRes.body.data.variance).toBe(20);

    const metricRes = await createApp(metricsRouter).get('/metrics/drift');
    expect(metricRes.body.data.sample_count).toBe(150);
    expect(metricRes.body.data.winner).toBe('ml');
    expect(metricRes.body.data.ml_r2).toBeCloseTo(0.8281);
  });

  it('edge case: no predictions yet returns 404', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const res = await createApp(predictionsRouter).get('/predictions/unknown-uuid');
    expect(res.status).toBe(404);
  });

  it('edge case: empty metrics DB returns tie', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{
        sample_count: '0', ml_mean: null, formula_mean: null,
        ml_mae: null, ml_rmse: null, pearson_r: null,
      }],
    });

    const res = await createApp(metricsRouter).get('/metrics/drift');
    expect(res.body.data.winner).toBe('tie');
    expect(res.body.data.sample_count).toBe(0);
  });
});
