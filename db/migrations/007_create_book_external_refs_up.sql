/*
Create external book reference mappings.

This table maps Smart DID book IDs to canonical GACS books.
It prevents webhook and incremental sync code from relying only on video_jobs.
*/

CREATE TABLE IF NOT EXISTS book_external_refs (
    id BIGSERIAL PRIMARY KEY,
    book_id UUID NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
    source_system VARCHAR(50) NOT NULL,
    external_book_id VARCHAR(200) NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_book_external_refs_source_external
        UNIQUE (source_system, external_book_id)
);

CREATE INDEX IF NOT EXISTS idx_book_external_refs_book_id
    ON book_external_refs(book_id);

CREATE INDEX IF NOT EXISTS idx_book_external_refs_source_external
    ON book_external_refs(source_system, external_book_id);

CREATE INDEX IF NOT EXISTS idx_book_external_refs_last_seen_at
    ON book_external_refs(last_seen_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON book_external_refs TO gacs_user;
GRANT USAGE, SELECT ON SEQUENCE book_external_refs_id_seq TO gacs_user;
