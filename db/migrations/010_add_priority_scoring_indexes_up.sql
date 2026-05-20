/*
Indexes for priority scoring and queue ordering.
*/

CREATE INDEX IF NOT EXISTS idx_book_engagement_score_refresh
    ON book_engagement(score_last_refreshed_at);

CREATE INDEX IF NOT EXISTS idx_book_engagement_priority_score
    ON book_engagement(generation_priority_score DESC);

CREATE INDEX IF NOT EXISTS idx_video_jobs_priority_open
    ON video_jobs(priority_score DESC, created_at ASC)
    WHERE status NOT IN ('completed', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_video_jobs_book_status
    ON video_jobs(book_id, status);