/*
Create Smart DID video state table.

Tracks playback state, URLs, and retry information reported by Smart DID
separately from canonical GACS video_jobs.
*/

CREATE TABLE IF NOT EXISTS smart_did_video_state (
    id BIGSERIAL PRIMARY KEY,
    book_id UUID NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
    status VARCHAR(50),
    video_url TEXT,
    subtitle_url TEXT,
    expires_at TIMESTAMPTZ,
    retry_count INT NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_smart_did_video_state_book UNIQUE (book_id)
);

CREATE INDEX idx_smart_did_video_state_book_id
    ON smart_did_video_state(book_id);
CREATE INDEX idx_smart_did_video_state_status
    ON smart_did_video_state(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON smart_did_video_state TO gacs_user;
GRANT USAGE, SELECT ON SEQUENCE smart_did_video_state_id_seq TO gacs_user;
