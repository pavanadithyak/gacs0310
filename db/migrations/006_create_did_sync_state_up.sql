/* Incremental sync cursor state for DID engagement sync */
CREATE TABLE IF NOT EXISTS did_sync_state (
    sync_name TEXT PRIMARY KEY,
    cursor_updated_at TIMESTAMPTZ,
    cursor_external_id TEXT,
    last_started_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_did_sync_state_last_success_at
    ON did_sync_state(last_success_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON did_sync_state TO gacs_user;
