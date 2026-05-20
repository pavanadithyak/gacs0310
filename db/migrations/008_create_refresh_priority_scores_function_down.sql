DROP FUNCTION IF EXISTS refresh_priority_scores();

ALTER TABLE book_engagement
    DROP COLUMN IF EXISTS score_last_refreshed_at,
    DROP COLUMN IF EXISTS generation_priority_score,
    DROP COLUMN IF EXISTS request_count_decayed;