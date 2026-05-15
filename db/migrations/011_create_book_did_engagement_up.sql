/*
Create DID engagement signals table.

This table stores Smart DID engagement data (request counts, ranking scores, etc.)
separately from the original book_engagement table which tracks user engagement.
*/

CREATE TABLE book_did_engagement (
    id BIGSERIAL PRIMARY KEY,
    book_id UUID NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
    source_system VARCHAR(50) NOT NULL DEFAULT 'smart_did',
    request_count INT NOT NULL DEFAULT 0,
    ranking_score NUMERIC(8,4) NOT NULL DEFAULT 0,
    last_requested_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ,
    request_count_decayed NUMERIC(12,4) DEFAULT 0,
    generation_priority_score NUMERIC(12,4) DEFAULT 0,
    score_last_refreshed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_book_did_engagement_book UNIQUE (book_id)
);

CREATE INDEX idx_book_did_engagement_book_id
    ON book_did_engagement(book_id);
CREATE INDEX idx_book_did_engagement_priority_score
    ON book_did_engagement(generation_priority_score DESC);
CREATE INDEX idx_book_did_engagement_score_refresh
    ON book_did_engagement(score_last_refreshed_at);
CREATE INDEX idx_book_did_engagement_last_requested
    ON book_did_engagement(last_requested_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON book_did_engagement TO gacs_user;
GRANT USAGE, SELECT ON SEQUENCE book_did_engagement_id_seq TO gacs_user;
