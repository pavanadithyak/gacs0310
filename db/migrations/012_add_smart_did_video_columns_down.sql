ALTER TABLE video_jobs DROP COLUMN IF EXISTS external_ref_id;
ALTER TABLE video_jobs DROP COLUMN IF EXISTS requested_at;
ALTER TABLE video_jobs DROP COLUMN IF EXISTS did_status_synced_at;
ALTER TABLE video_jobs DROP COLUMN IF EXISTS expires_at;
ALTER TABLE video_jobs DROP COLUMN IF EXISTS did_request_retries;
ALTER TABLE video_jobs DROP COLUMN IF EXISTS did_reported_status;
