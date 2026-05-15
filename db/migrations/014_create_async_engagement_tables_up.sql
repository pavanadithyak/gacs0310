/*
Create async engagement processing tables.

These tables are targets for deferred BullMQ jobs from webhook handlers:
- book_engagement_snapshots: time-series engagement data
- book_recommendation_segments: recommendation context from Smart DID
*/

CREATE TABLE IF NOT EXISTS book_engagement_snapshots (
    id BIGSERIAL PRIMARY KEY,
    book_id UUID NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
    source_system VARCHAR(50) NOT NULL,
    request_count INT NOT NULL DEFAULT 0,
    ranking_score NUMERIC(8,4),
    last_requested_at TIMESTAMPTZ,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS book_recommendation_segments (
    id BIGSERIAL PRIMARY KEY,
    book_id UUID NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
    source_system VARCHAR(50) NOT NULL,
    age_group VARCHAR(50),
    sort_order VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_book_engagement_snapshots_book_id
    ON book_engagement_snapshots(book_id);
CREATE INDEX idx_book_engagement_snapshots_captured_at
    ON book_engagement_snapshots(captured_at DESC);
CREATE INDEX idx_book_recommendation_segments_book_id
    ON book_recommendation_segments(book_id);
CREATE INDEX idx_book_recommendation_segments_age_group
    ON book_recommendation_segments(age_group);

GRANT SELECT, INSERT, UPDATE, DELETE ON book_engagement_snapshots TO gacs_user;
GRANT USAGE, SELECT ON SEQUENCE book_engagement_snapshots_id_seq TO gacs_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON book_recommendation_segments TO gacs_user;
GRANT USAGE, SELECT ON SEQUENCE book_recommendation_segments_id_seq TO gacs_user;
