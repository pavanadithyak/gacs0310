ALTER TABLE video_jobs ADD COLUMN priority_score DECIMAL(10, 4) NOT NULL DEFAULT 0;
ALTER TABLE video_jobs ADD COLUMN retry_count INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN video_jobs.priority_score IS 'Score for job scheduling (0-100 range, 0 = lowest priority)';
COMMENT ON COLUMN video_jobs.retry_count IS 'Number of times job has been retried';
