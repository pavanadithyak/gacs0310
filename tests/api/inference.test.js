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

let app;

beforeAll(async () => {
  const mod = await import('../../src/api/inference-routes.js');
  app = express();
  app.use(express.json());
  app.use(mod.default);
});

beforeEach(() => {
  mockPool.query.mockReset();
  mockQueue.add.mockReset();
});

describe('Inference Trigger API', () => {
  it('queues specific book_ids when provided', async () => {
    mockQueue.add.mockResolvedValue({ id: 'job-1' });

    const res = await supertest(app)
      .post('/inference/trigger')
      .send({ book_ids: ['uuid-1', 'uuid-2'] });

    expect(mockQueue.add).toHaveBeenCalledWith(
      'manual-inference-trigger',
      { batch: ['uuid-1', 'uuid-2'], force_recompute: false },
      { attempts: 1 },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.queued_count).toBe(2);
    expect(res.body.data.job_id).toBe('job-1');
  });

  it('queries pending video_jobs when no book_ids given', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ book_id: 'uuid-a' }, { book_id: 'uuid-b' }] });
    mockQueue.add.mockResolvedValue({ id: 'job-2' });

    const res = await supertest(app).post('/inference/trigger').send({});

    expect(mockPool.query.mock.calls[0][0]).toContain('video_jobs');
    expect(mockPool.query.mock.calls[0][0]).toContain('pending');
    expect(mockQueue.add).toHaveBeenCalled();
    expect(res.body.data.queued_count).toBe(2);
  });

  it('returns zero count when no books to process', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const res = await supertest(app).post('/inference/trigger').send({});
    expect(res.body.data.queued_count).toBe(0);
  });

  it('returns 500 on queue error', async () => {
    mockQueue.add.mockRejectedValue(new Error('Queue full'));

    const res = await supertest(app)
      .post('/inference/trigger')
      .send({ book_ids: ['uuid-1'] });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Queue full');
  });
});
