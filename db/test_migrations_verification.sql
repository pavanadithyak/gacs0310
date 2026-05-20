/*
================================================================================
Database Migration Verification Script
================================================================================

Run:
psql -h staging.gacs.internal -p 5432 -U gacs_user -d gacs_staging -f db/test_migrations_verification.sql

================================================================================
*/

\echo '>>> 1. Listing all tables...'
\dt

\echo '>>> 2. Verifying column additions to books and video_jobs tables...'

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'books'
  AND column_name IN ('engagement_count', 'last_engagement_at')
ORDER BY ordinal_position;

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'video_jobs'
  AND column_name IN (
    'priority_score',
    'retry_count',
    'requested_at',
    'external_ref_id',
    'did_reported_status',
    'did_request_retries',
    'expires_at',
    'did_status_synced_at'
  )
ORDER BY ordinal_position;

\echo '>>> 3. Showing table structures for new tables...'

\echo 'Table: book_engagement'
\d book_engagement

\echo 'Table: audience_validation'
\d audience_validation

\echo 'Table: did_sync_log'
\d did_sync_log

\echo 'Table: did_sync_state'
\d did_sync_state

\echo 'Table: book_external_refs'
\d book_external_refs

\echo '>>> 4. Listing all public indexes...'

SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

\echo '>>> 5. Showing constraints on new tables...'

SELECT table_name, constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'public'
  AND table_name IN (
    'book_engagement',
    'audience_validation',
    'did_sync_log',
    'did_sync_state',
    'book_external_refs'
  )
ORDER BY table_name, constraint_type, constraint_name;

\echo '>>> 6. Verifying permissions for gacs_user...'

SELECT table_name, privilege_type
FROM information_schema.table_privileges
WHERE grantee = 'gacs_user'
  AND table_schema = 'public'
  AND table_name IN (
    'book_engagement',
    'audience_validation',
    'did_sync_log',
    'did_sync_state',
    'book_external_refs'
  )
ORDER BY table_name, privilege_type;

\echo '>>> 7. Verifying did_sync_state cursor upsert...'

INSERT INTO did_sync_state (
  sync_name,
  cursor_updated_at,
  cursor_external_id,
  last_started_at,
  last_success_at,
  last_error,
  created_at,
  updated_at
)
VALUES (
  'verification.smart_did.video_records',
  NOW(),
  'verification-book-id',
  NOW(),
  NOW(),
  NULL,
  NOW(),
  NOW()
)
ON CONFLICT (sync_name)
DO UPDATE SET
  cursor_updated_at = EXCLUDED.cursor_updated_at,
  cursor_external_id = EXCLUDED.cursor_external_id,
  last_success_at = NOW(),
  last_error = NULL,
  updated_at = NOW();

SELECT sync_name, cursor_external_id, last_error
FROM did_sync_state
WHERE sync_name = 'verification.smart_did.video_records';

DELETE FROM did_sync_state
WHERE sync_name = 'verification.smart_did.video_records';

\echo '>>> 8. Verifying book_engagement changed-only UPSERT syntax...'

PREPARE verify_book_engagement_upsert (
  BIGINT,
  INTEGER,
  NUMERIC,
  TIMESTAMPTZ
) AS
INSERT INTO book_engagement (
  book_id,
  source_system,
  request_count,
  ranking_score,
  last_requested_at,
  synced_at,
  created_at,
  updated_at
)
VALUES (
  $1,
  'smart_did',
  $2,
  $3,
  $4,
  NOW(),
  NOW(),
  NOW()
)
ON CONFLICT (book_id)
DO UPDATE SET
  source_system = EXCLUDED.source_system,
  request_count = EXCLUDED.request_count,
  ranking_score = EXCLUDED.ranking_score,
  last_requested_at = EXCLUDED.last_requested_at,
  synced_at = NOW(),
  updated_at = NOW()
WHERE book_engagement.request_count IS DISTINCT FROM EXCLUDED.request_count
   OR book_engagement.ranking_score IS DISTINCT FROM EXCLUDED.ranking_score
   OR book_engagement.last_requested_at IS DISTINCT FROM EXCLUDED.last_requested_at;

DEALLOCATE verify_book_engagement_upsert;

\echo '>>> Migration verification completed.'