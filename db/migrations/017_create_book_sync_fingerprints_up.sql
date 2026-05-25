/* Drift detection fingerprints for Smart DID sync */
CREATE TABLE book_sync_fingerprints (
  id BIGSERIAL PRIMARY KEY,
  book_id UUID NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  external_book_id VARCHAR(255) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  last_synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_book_sync_fingerprints_external UNIQUE(external_book_id)
);

CREATE INDEX idx_book_sync_fingerprints_book_id ON book_sync_fingerprints(book_id);
CREATE INDEX idx_book_sync_fingerprints_external ON book_sync_fingerprints(external_book_id);

COMMENT ON COLUMN book_sync_fingerprints.id IS 'Primary key, auto-incrementing';
COMMENT ON COLUMN book_sync_fingerprints.book_id IS 'Reference to canonical books table';
COMMENT ON COLUMN book_sync_fingerprints.external_book_id IS 'Book ID in the external (Smart DID) system';
COMMENT ON COLUMN book_sync_fingerprints.payload_hash IS 'SHA-256 hash of the last synced payload for drift detection';
COMMENT ON COLUMN book_sync_fingerprints.last_synced_at IS 'Timestamp of the last successful sync';
COMMENT ON COLUMN book_sync_fingerprints.created_at IS 'Row creation timestamp';
COMMENT ON COLUMN book_sync_fingerprints.updated_at IS 'Last update timestamp';

GRANT SELECT, INSERT, UPDATE, DELETE ON book_sync_fingerprints TO gacs_user;
GRANT USAGE ON SEQUENCE book_sync_fingerprints_id_seq TO gacs_user;
