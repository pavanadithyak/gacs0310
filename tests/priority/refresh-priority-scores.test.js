import { describe, expect, test } from '@jest/globals';

const PRIORITY_FORMULA_WEIGHTS = {
  decayedRequest: 40,
  ranking: 30,
  retry: 15,
  expiry: 10,
  starvation: 5,
};

function calculatePriorityScore({
  requestCount = 0,
  rankingScore = 0,
  retryCount = 0,
  lastRequestedAt,
  expiresAt,
  createdAt,
  now,
}) {
  const daysSinceRequest =
    (now.getTime() - new Date(lastRequestedAt || createdAt || now).getTime()) /
    86400000;

  const decayedRequestSignal =
    Math.log(1 + requestCount) * Math.exp((-Math.log(2) / 30) * daysSinceRequest);

  const normalizedRankingScore =
    rankingScore > 1
      ? Math.min(rankingScore / 100, 1)
      : Math.max(rankingScore, 0);

  const retrySignal = Math.min(retryCount / 5, 1);

  const expirySignal = getExpirySignal(expiresAt, now);

  const starvationSignal = Math.min(
    (now.getTime() - new Date(createdAt || now).getTime()) / 604800000,
    1,
  );

  return (
    PRIORITY_FORMULA_WEIGHTS.decayedRequest * decayedRequestSignal +
    PRIORITY_FORMULA_WEIGHTS.ranking * normalizedRankingScore +
    PRIORITY_FORMULA_WEIGHTS.retry * retrySignal +
    PRIORITY_FORMULA_WEIGHTS.expiry * expirySignal +
    PRIORITY_FORMULA_WEIGHTS.starvation * starvationSignal
  );
}

function getExpirySignal(expiresAt, now) {
  if (!expiresAt) return 0;

  const msUntilExpiry = new Date(expiresAt).getTime() - now.getTime();

  if (msUntilExpiry <= 0) return 1;
  if (msUntilExpiry <= 24 * 60 * 60 * 1000) return 0.75;
  if (msUntilExpiry <= 3 * 24 * 60 * 60 * 1000) return 0.4;

  return 0;
}

describe('priority scoring formula', () => {
  test('recent requests score higher than old requests', () => {
    const now = new Date('2026-05-04T12:00:00.000Z');

    const recent = calculatePriorityScore({
      requestCount: 20,
      rankingScore: 0.5,
      lastRequestedAt: '2026-05-04T11:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z',
      now,
    });

    const old = calculatePriorityScore({
      requestCount: 20,
      rankingScore: 0.5,
      lastRequestedAt: '2026-03-01T00:00:00.000Z',
      createdAt: '2026-03-01T00:00:00.000Z',
      now,
    });

    expect(recent).toBeGreaterThan(old);
  });

  test('ranking score supports both 0-1 and 0-100 formats', () => {
    const now = new Date('2026-05-04T12:00:00.000Z');

    const scoreOneScale = calculatePriorityScore({
      rankingScore: 0.8,
      createdAt: now,
      now,
    });

    const scoreHundredScale = calculatePriorityScore({
      rankingScore: 80,
      createdAt: now,
      now,
    });

    expect(scoreHundredScale).toBeCloseTo(scoreOneScale, 5);
  });

  test('retry signal is capped', () => {
    const now = new Date('2026-05-04T12:00:00.000Z');

    const fiveRetries = calculatePriorityScore({
      retryCount: 5,
      createdAt: now,
      now,
    });

    const fiftyRetries = calculatePriorityScore({
      retryCount: 50,
      createdAt: now,
      now,
    });

    expect(fiftyRetries).toBeCloseTo(fiveRetries, 5);
  });

  test('expired videos score higher than non-expiring videos', () => {
    const now = new Date('2026-05-04T12:00:00.000Z');

    const expired = calculatePriorityScore({
      expiresAt: '2026-05-04T11:00:00.000Z',
      createdAt: now,
      now,
    });

    const notExpiring = calculatePriorityScore({
      expiresAt: '2026-06-04T11:00:00.000Z',
      createdAt: now,
      now,
    });

    expect(expired).toBeGreaterThan(notExpiring);
  });
});
