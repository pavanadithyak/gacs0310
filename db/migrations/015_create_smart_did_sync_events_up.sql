CREATE TABLE IF NOT EXISTS smart_did_sync_events (
    id BIGSERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    book_id VARCHAR(200) NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_json JSONB,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    retry_count INT NOT NULL DEFAULT 0,
    last_error TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_smart_did_sync_events_idempotency UNIQUE (idempotency_key),
    CONSTRAINT chk_smart_did_sync_events_status
        CHECK (status IN ('pending', 'processing', 'processed', 'retry', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_smart_did_sync_events_status_received
    ON smart_did_sync_events(status, received_at ASC);

CREATE INDEX IF NOT EXISTS idx_smart_did_sync_events_book_id
    ON smart_did_sync_events(book_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON smart_did_sync_events TO gacs_user;
GRANT USAGE, SELECT ON SEQUENCE smart_did_sync_events_id_seq TO gacs_user;