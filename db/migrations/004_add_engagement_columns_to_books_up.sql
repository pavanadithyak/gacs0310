ALTER TABLE books ADD COLUMN engagement_count INT NOT NULL DEFAULT 0;
ALTER TABLE books ADD COLUMN last_engagement_at TIMESTAMP DEFAULT NULL;

COMMENT ON COLUMN books.engagement_count IS 'Total user engagements with this book';
COMMENT ON COLUMN books.last_engagement_at IS 'Timestamp of most recent engagement';
