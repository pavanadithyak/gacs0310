/* Event inbox for Smart DID webhook events */
CREATE TABLE smart_did_sync_events (
  id BIGSERIAL PRIMARY KEY,
  book_id UUID NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 5,
  last_error TEXT,
  scheduled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_smart_did_sync_events_idempotency UNIQUE(idempotency_key)
);

CREATE INDEX idx_smart_did_sync_events_status ON smart_did_sync_events(status);
CREATE INDEX idx_smart_did_sync_events_book_id ON smart_did_sync_events(book_id);
CREATE INDEX idx_smart_did_sync_events_created_at ON smart_did_sync_events(created_at);

COMMENT ON COLUMN smart_did_sync_events.id IS 'Primary key, auto-incrementing';
COMMENT ON COLUMN smart_did_sync_events.book_id IS 'Reference to canonical books table';
COMMENT ON COLUMN smart_did_sync_events.event_type IS 'Webhook event type identifier';
COMMENT ON COLUMN smart_did_sync_events.idempotency_key IS 'Deduplication key for idempotent processing';
COMMENT ON COLUMN smart_did_sync_events.payload_json IS 'Raw webhook event payload';
COMMENT ON COLUMN smart_did_sync_events.status IS 'Processing status: pending/completed/failed';
COMMENT ON COLUMN smart_did_sync_events.retry_count IS 'Number of retry attempts so far';
COMMENT ON COLUMN smart_did_sync_events.max_retries IS 'Maximum allowed retry attempts';
COMMENT ON COLUMN smart_did_sync_events.last_error IS 'Error message from last failed attempt';
COMMENT ON COLUMN smart_did_sync_events.scheduled_at IS 'Scheduled processing time';
COMMENT ON COLUMN smart_did_sync_events.created_at IS 'Row creation timestamp';
COMMENT ON COLUMN smart_did_sync_events.updated_at IS 'Last update timestamp';

GRANT SELECT, INSERT, UPDATE, DELETE ON smart_did_sync_events TO gacs_user;
GRANT USAGE ON SEQUENCE smart_did_sync_events_id_seq TO gacs_user;
