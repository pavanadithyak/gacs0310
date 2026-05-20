import db from '../../db/client.js';

export class CanonicalBookUpsertService {
  constructor({ database = db } = {}) {
    this.db = database;
  }

  async upsert(canonicalBook) {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      const bookId = await this.upsertBook(client, canonicalBook);
      await this.upsertExternalRef(client, bookId, canonicalBook.externalBookId);
      await this.upsertEngagement(client, bookId, canonicalBook);
      await this.upsertVideoState(client, bookId, canonicalBook);
      await this.upsertFingerprint(client, bookId, canonicalBook);

      await client.query('COMMIT');
      return { bookId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertBook(client, canonicalBook) {
    const existing = await client.query(
      `SELECT book_id
         FROM book_external_refs
        WHERE source_system = 'smart_did'
          AND external_book_id = $1
        LIMIT 1`,
      [canonicalBook.externalBookId],
    );

    if (existing.rows[0]?.book_id) {
      const bookId = existing.rows[0].book_id;

      await client.query(
        `UPDATE books
            SET title = COALESCE($2, title),
                author = COALESCE($3, author),
                publisher = COALESCE($4, publisher),
                isbn = COALESCE($5, isbn),
                summary_raw = COALESCE($6, summary_raw),
                updated_at = NOW()
          WHERE book_id = $1`,
        [
          bookId,
          canonicalBook.metadata.title,
          canonicalBook.metadata.author,
          canonicalBook.metadata.publisher,
          canonicalBook.metadata.isbn,
          canonicalBook.metadata.summary,
        ],
      );

      return bookId;
    }

    const inserted = await client.query(
      `INSERT INTO books (
         title,
         author,
         publisher,
         isbn,
         summary_raw,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (isbn)
       DO UPDATE SET
         title = COALESCE(EXCLUDED.title, books.title),
         author = COALESCE(EXCLUDED.author, books.author),
         publisher = COALESCE(EXCLUDED.publisher, books.publisher),
         summary_raw = COALESCE(EXCLUDED.summary_raw, books.summary_raw),
         updated_at = NOW()
       RETURNING book_id`,
      [
        canonicalBook.metadata.title || 'Untitled',
        canonicalBook.metadata.author,
        canonicalBook.metadata.publisher,
        canonicalBook.metadata.isbn,
        canonicalBook.metadata.summary,
      ],
    );

    return inserted.rows[0].book_id;
  }

  async upsertExternalRef(client, bookId, externalBookId) {
    await client.query(
      `INSERT INTO book_external_refs (
         book_id,
         source_system,
         external_book_id,
         first_seen_at,
         last_seen_at,
         created_at,
         updated_at
       )
       VALUES ($1, 'smart_did', $2, NOW(), NOW(), NOW(), NOW())
       ON CONFLICT (source_system, external_book_id)
       DO UPDATE SET
         book_id = EXCLUDED.book_id,
         last_seen_at = NOW(),
         updated_at = NOW()`,
      [bookId, externalBookId],
    );
  }

  async upsertEngagement(client, bookId, canonicalBook) {
    const tableName = await tableExists(client, 'book_did_engagement')
      ? 'book_did_engagement'
      : 'book_engagement';

    await client.query(
      `INSERT INTO ${tableName} (
         book_id,
         source_system,
         request_count,
         ranking_score,
         last_requested_at,
         synced_at,
         created_at,
         updated_at
       )
       VALUES ($1, 'smart_did', $2, $3, $4, NOW(), NOW(), NOW())
       ON CONFLICT (book_id)
       DO UPDATE SET
         source_system = EXCLUDED.source_system,
         request_count = EXCLUDED.request_count,
         ranking_score = EXCLUDED.ranking_score,
         last_requested_at = EXCLUDED.last_requested_at,
         synced_at = NOW(),
         updated_at = NOW()
       WHERE ${tableName}.request_count IS DISTINCT FROM EXCLUDED.request_count
          OR ${tableName}.ranking_score IS DISTINCT FROM EXCLUDED.ranking_score
          OR ${tableName}.last_requested_at IS DISTINCT FROM EXCLUDED.last_requested_at`,
      [
        bookId,
        canonicalBook.engagement.requestCount,
        canonicalBook.engagement.rankingScore,
        canonicalBook.engagement.lastRequestedAt,
      ],
    );
  }

  async upsertVideoState(client, bookId, canonicalBook) {
    if (!(await tableExists(client, 'smart_did_video_state'))) return;

    await client.query(
      `INSERT INTO smart_did_video_state (
         book_id,
         status,
         video_url,
         subtitle_url,
         expires_at,
         retry_count,
         error_message,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (book_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         video_url = EXCLUDED.video_url,
         subtitle_url = EXCLUDED.subtitle_url,
         expires_at = EXCLUDED.expires_at,
         retry_count = EXCLUDED.retry_count,
         error_message = EXCLUDED.error_message,
         updated_at = NOW()`,
      [
        bookId,
        canonicalBook.video.status,
        canonicalBook.video.videoUrl,
        canonicalBook.video.subtitleUrl,
        canonicalBook.video.expiresAt,
        canonicalBook.engagement.retryCount,
        canonicalBook.video.errorMessage,
      ],
    );
  }

  async upsertFingerprint(client, bookId, canonicalBook) {
    await client.query(
      `INSERT INTO book_sync_fingerprints (
         book_id,
         source_system,
         external_book_id,
         fingerprint,
         source_updated_at,
         synced_at,
         created_at,
         updated_at
       )
       VALUES ($1, 'smart_did', $2, $3, $4, NOW(), NOW(), NOW())
       ON CONFLICT (source_system, external_book_id)
       DO UPDATE SET
         book_id = EXCLUDED.book_id,
         fingerprint = EXCLUDED.fingerprint,
         source_updated_at = EXCLUDED.source_updated_at,
         synced_at = NOW(),
         updated_at = NOW()`,
      [
        bookId,
        canonicalBook.externalBookId,
        canonicalBook.fingerprint,
        canonicalBook.sourceUpdatedAt,
      ],
    );
  }
}

async function tableExists(client, tableName) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = $1
     )`,
    [tableName],
  );

  return Boolean(result.rows[0]?.exists);
}