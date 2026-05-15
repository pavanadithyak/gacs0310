/* Table description: tracks user engagement with books */
CREATE TABLE book_engagement (
    id BIGSERIAL PRIMARY KEY,
    book_id UUID NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    engagement_type VARCHAR(50) NOT NULL,
    engagement_count INT DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_book_engagement_book_user UNIQUE(book_id, user_id)
);

CREATE INDEX idx_book_engagement_book_id ON book_engagement(book_id);
CREATE INDEX idx_book_engagement_user_id ON book_engagement(user_id);
CREATE INDEX idx_book_engagement_type ON book_engagement(engagement_type);

GRANT SELECT, INSERT, UPDATE, DELETE ON book_engagement TO gacs_user;

COMMENT ON TABLE book_engagement IS 'Tracks user engagement with books';
COMMENT ON COLUMN book_engagement.book_id IS 'Foreign key to books table';
COMMENT ON COLUMN book_engagement.user_id IS 'Identifier for the user';
COMMENT ON COLUMN book_engagement.engagement_type IS 'Type of engagement (e.g., view, like, share)';
COMMENT ON COLUMN book_engagement.engagement_count IS 'Number of times this engagement occurred';
