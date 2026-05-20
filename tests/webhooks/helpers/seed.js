/**
 * Helpers for seeding and cleaning test data.
 */

export async function seedBookWithRef(db, bookId, externalBookId) {
  await db.query(
    `INSERT INTO books (book_id, title, author, isbn)
     VALUES ($1, 'Test Book', 'Test Author', $2)
     ON CONFLICT (book_id) DO NOTHING`,
    [bookId, `isbn-${externalBookId}`],
  );

  await db.query(
    `INSERT INTO book_external_refs (
       book_id,
       source_system,
       external_book_id,
       first_seen_at,
       last_seen_at
     )
     VALUES ($1, 'smart_did', $2, NOW(), NOW())
     ON CONFLICT (source_system, external_book_id)
     DO NOTHING`,
    [bookId, externalBookId],
  );

  return bookId;
}

export async function seedVideoJob(db, bookId, status = 'pending') {
  await db.query(
    `INSERT INTO video_jobs (book_id, status, created_at)
     VALUES ($1, $2, NOW())`,
    [bookId, status],
  );
}

export async function seedDidSyncState(
  db,
  {
    syncName = 'smart_did.video_records',
    cursorUpdatedAt = '2026-04-27T00:00:00.000Z',
    cursorExternalId = 'test-book-001',
  } = {},
) {
  await db.query(
    `INSERT INTO did_sync_state (
       sync_name,
       cursor_updated_at,
       cursor_external_id,
       last_success_at,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, NOW(), NOW(), NOW())
     ON CONFLICT (sync_name)
     DO UPDATE SET
       cursor_updated_at = EXCLUDED.cursor_updated_at,
       cursor_external_id = EXCLUDED.cursor_external_id,
       last_success_at = NOW(),
       updated_at = NOW()`,
    [syncName, cursorUpdatedAt, cursorExternalId],
  );
}

export async function cleanTestData(db) {
  const testBookSubquery = `SELECT book_id FROM books WHERE title LIKE 'Test%'`;

  await deleteIfTableExists(
    db,
    'did_sync_log',
    `external_book_id LIKE 'test-%'
     OR book_id IN (${testBookSubquery})`,
  );

  await deleteIfTableExists(
    db,
    'smart_did_sync_events',
    `book_id LIKE 'test-%'`,
  );

  await deleteIfTableExists(
    db,
    'book_sync_fingerprints',
    `external_book_id LIKE 'test-%'
     OR book_id IN (${testBookSubquery})`,
  );

  await deleteIfTableExists(
    db,
    'smart_did_video_state',
    `book_id IN (${testBookSubquery})`,
  );

  await deleteIfTableExists(
    db,
    'book_engagement_snapshots',
    `book_id IN (${testBookSubquery})`,
  );

  await deleteIfTableExists(
    db,
    'book_engagement',
    `book_id IN (${testBookSubquery})`,
  );

  await deleteIfTableExists(
    db,
    'book_did_engagement',
    `book_id IN (${testBookSubquery})`,
  );

  await deleteIfTableExists(
    db,
    'book_recommendation_segments',
    `book_id IN (${testBookSubquery})`,
  );

  await db.query(
    `DELETE FROM video_jobs
      WHERE book_id IN (${testBookSubquery})`,
  );

  await db.query(
    `DELETE FROM book_external_refs
      WHERE external_book_id LIKE 'test-%'
         OR book_id IN (${testBookSubquery})`,
  );

  await db.query(
    `DELETE FROM books
      WHERE title LIKE 'Test%'`,
  );
}

async function deleteIfTableExists(db, tableName, whereClause) {
  const exists = await tableExists(db, tableName);
  if (!exists) return;

  await db.query(`DELETE FROM ${tableName} WHERE ${whereClause}`);
}

async function tableExists(db, tableName) {
  const result = await db.query(
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
