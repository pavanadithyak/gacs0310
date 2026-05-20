ALTER TABLE did_sync_log
    ADD COLUMN IF NOT EXISTS event_type VARCHAR(100),
    ADD COLUMN IF NOT EXISTS attempt_number INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
DECLARE
    constraint_record RECORD;
BEGIN
    FOR constraint_record IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'did_sync_log'::regclass
          AND contype = 'u'
          AND pg_get_constraintdef(oid) ILIKE '%UNIQUE (idempotency_key)%'
    LOOP
        EXECUTE format('ALTER TABLE did_sync_log DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;
END $$;

DO $$
DECLARE
    constraint_record RECORD;
BEGIN
    FOR constraint_record IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'did_sync_log'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE did_sync_log DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;
END $$;

ALTER TABLE did_sync_log
    ADD CONSTRAINT chk_did_sync_log_status
    CHECK (
        status IN (
            'success',
            'partial',
            'failed',
            'skipped',
            'webhook_received',
            'sync_started',
            'sync_completed',
            'sync_failed',
            'canonical_fetch_started',
            'canonical_fetch_succeeded',
            'canonical_fetch_failed',
            'drift_check_started',
            'drift_detected',
            'no_drift',
            'upsert_started',
            'upsert_succeeded',
            'upsert_failed',
            'retry_scheduled',
            'error'
        )
    );

CREATE INDEX IF NOT EXISTS idx_did_sync_log_external_book_id
    ON did_sync_log(external_book_id);

CREATE INDEX IF NOT EXISTS idx_did_sync_log_event_type
    ON did_sync_log(event_type);

CREATE INDEX IF NOT EXISTS idx_did_sync_log_sync_type_status
    ON did_sync_log(sync_type, status);

CREATE INDEX IF NOT EXISTS idx_did_sync_log_idempotency_key
    ON did_sync_log(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_did_sync_log_synced_at
    ON did_sync_log(synced_at DESC);