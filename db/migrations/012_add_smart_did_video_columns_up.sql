/*
Add Smart DID tracking columns to video_jobs.

These columns store playback state and sync metadata reported by Smart DID.
*/

ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS did_reported_status VARCHAR(50);
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS did_request_retries INT NOT NULL DEFAULT 0;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS did_status_synced_at TIMESTAMPTZ;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ;
ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS external_ref_id VARCHAR(200);

COMMENT ON COLUMN video_jobs.did_reported_status IS 'Status reported by Smart DID';
COMMENT ON COLUMN video_jobs.did_request_retries IS 'Retry count from Smart DID';
COMMENT ON COLUMN video_jobs.expires_at IS 'Video URL expiration timestamp';
COMMENT ON COLUMN video_jobs.did_status_synced_at IS 'Last sync timestamp from Smart DID';
COMMENT ON COLUMN video_jobs.requested_at IS 'When video was last requested';
COMMENT ON COLUMN video_jobs.external_ref_id IS 'External book reference ID';
