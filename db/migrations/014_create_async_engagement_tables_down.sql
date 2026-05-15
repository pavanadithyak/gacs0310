DROP INDEX IF EXISTS idx_book_recommendation_segments_age_group;
DROP INDEX IF EXISTS idx_book_recommendation_segments_book_id;
DROP TABLE IF EXISTS book_recommendation_segments CASCADE;

DROP INDEX IF EXISTS idx_book_engagement_snapshots_captured_at;
DROP INDEX IF EXISTS idx_book_engagement_snapshots_book_id;
DROP TABLE IF EXISTS book_engagement_snapshots CASCADE;
