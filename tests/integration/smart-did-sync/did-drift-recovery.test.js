import { describe, expect, test, beforeAll, afterAll } from '@jest/globals';
import pg from 'pg';
import { DriftDetector } from '../../../src/sync/did/drift-detector.service.js';
import { CanonicalBookUpsertService } from '../../../src/sync/did/canonical-book-upsert.service.js';

const { Pool } = pg;
const connectionString = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeWithDb = connectionString ? describe : describe.skip;

describeWithDb('Smart DID drift recovery', () => {
  let db;
  let detector;
  let upsertService;

  beforeAll(() => {
    db = new Pool({ connectionString });
    detector = new DriftDetector();
    upsertService = new CanonicalBookUpsertService({ database: db });
  });

  afterAll(async () => {
    await db.end();
  });

  test('normalizes full book payload, detects drift, and upserts canonical data', async () => {
    const externalBookId = `test-drift-${Date.now()}`;

    const payload = {
      bookId: externalBookId,
      title: 'Test Drift Book',
      author: 'Test Author',
      publisher: 'Test Publisher',
      isbn: `isbn-${externalBookId}`,
      summary: 'A test book summary',
      requestCount: 7,
      rankingScore: 0.8,
      lastRequestedAt: new Date().toISOString(),
      retryCount: 1,
      status: 'READY',
      videoUrl: 'https://example.com/video.mp4',
      subtitleUrl: 'https://example.com/subtitle.vtt',
      updatedAt: new Date().toISOString(),
    };

    const canonicalBook = detector.normalize(payload);
    const drift = detector.detect({
      canonicalBook,
      storedFingerprint: null,
    });

    expect(drift.hasDrift).toBe(true);

    const result = await upsertService.upsert(canonicalBook);

    expect(result.bookId).toBeTruthy();

    const fingerprintResult = await db.query(
      `SELECT fingerprint
         FROM book_sync_fingerprints
        WHERE source_system = 'smart_did'
          AND external_book_id = $1`,
      [externalBookId],
    );

    expect(fingerprintResult.rows[0].fingerprint).toBe(canonicalBook.fingerprint);
  });
});