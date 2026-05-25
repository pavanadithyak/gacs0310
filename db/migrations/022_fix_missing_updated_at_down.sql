ALTER TABLE did_sync_log DROP COLUMN IF EXISTS updated_at;
ALTER TABLE book_engagement_snapshots DROP COLUMN IF EXISTS updated_at;
ALTER TABLE book_recommendation_segments DROP COLUMN IF EXISTS updated_at;
ALTER TABLE ml_prediction_log DROP COLUMN IF EXISTS updated_at;
