/* Table description: Smart DID sync operation audit trail */
CREATE TABLE did_sync_log (
    id BIGSERIAL PRIMARY KEY,
    sync_timestamp TIMESTAMP NOT NULL,
    videos_synced INT DEFAULT 0,
    videos_changed INT DEFAULT 0,
    sync_status VARCHAR(50) NOT NULL DEFAULT 'success',
    error_message TEXT DEFAULT NULL,
    sync_duration_ms INT DEFAULT NULL,
    synced_by VARCHAR(255) DEFAULT 'system',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_did_sync_log_status CHECK (sync_status IN ('success', 'partial', 'failed'))
);

CREATE INDEX idx_did_sync_log_timestamp ON did_sync_log(sync_timestamp DESC);
CREATE INDEX idx_did_sync_log_status ON did_sync_log(sync_status);
CREATE INDEX idx_did_sync_log_created_at ON did_sync_log(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON did_sync_log TO gacs_user;

COMMENT ON TABLE did_sync_log IS 'Smart DID sync operation audit trail';
COMMENT ON COLUMN did_sync_log.sync_timestamp IS 'Timestamp when the sync operation occurred';
COMMENT ON COLUMN did_sync_log.videos_synced IS 'Total number of videos processed in the sync';
COMMENT ON COLUMN did_sync_log.videos_changed IS 'Number of videos that were actually updated';
COMMENT ON COLUMN did_sync_log.sync_status IS 'Status of the sync operation (success, partial, failed)';
COMMENT ON COLUMN did_sync_log.error_message IS 'Error message if the sync failed';
COMMENT ON COLUMN did_sync_log.sync_duration_ms IS 'Duration of the sync operation in milliseconds';
COMMENT ON COLUMN did_sync_log.synced_by IS 'Identifier of the system or user that triggered the sync';
