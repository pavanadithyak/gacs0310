DROP INDEX IF EXISTS idx_did_sync_log_synced_at;
DROP INDEX IF EXISTS idx_did_sync_log_idempotency_key;
DROP INDEX IF EXISTS idx_did_sync_log_sync_type_status;
DROP INDEX IF EXISTS idx_did_sync_log_event_type;
DROP INDEX IF EXISTS idx_did_sync_log_external_book_id;

ALTER TABLE did_sync_log
    DROP CONSTRAINT IF EXISTS chk_did_sync_log_status;

ALTER TABLE did_sync_log
    ADD CONSTRAINT chk_did_sync_log_status
    CHECK (status IN ('success', 'partial', 'failed')) NOT VALID;

ALTER TABLE did_sync_log
    DROP COLUMN IF EXISTS updated_at,
    DROP COLUMN IF EXISTS created_at,
    DROP COLUMN IF EXISTS attempt_number,
    DROP COLUMN IF EXISTS event_type;