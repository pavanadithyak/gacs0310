-- =============================================================================
-- GACS Base Schema (production-equivalent)
-- =============================================================================
-- This file represents the existing GACS production schema as of the start of
-- the Phase 2 sprint. DO NOT MODIFY THIS FILE in your PRs.
--
-- Schema additions (new tables / columns) belong in your migration tooling
-- (e.g. db/migrations/ for raw SQL, or migrations/ for Alembic) — never edit
-- this file directly.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- books: canonical book entity
-- ---------------------------------------------------------------------------
CREATE TABLE books (
    book_id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(500) NOT NULL,
    author          VARCHAR(200),
    publisher       VARCHAR(200),
    isbn            VARCHAR(20),
    summary         TEXT,
    genre           VARCHAR(100),
    published_year  INT,
    cover_image_url TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);  

CREATE INDEX idx_books_isbn  ON books(isbn);
CREATE INDEX idx_books_genre ON books(genre);

-- ---------------------------------------------------------------------------
-- video_jobs: per-book video generation pipeline state
-- ---------------------------------------------------------------------------
CREATE TABLE video_jobs (
    job_id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id       UUID         NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
    status        VARCHAR(30)  NOT NULL DEFAULT 'pending',
    video_url     TEXT,
    started_at    TIMESTAMPTZ,
    completed_at  TIMESTAMPTZ,
    error_message TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT video_jobs_status_check CHECK (
        status IN ('pending','queued','running','completed','failed','cancelled')
    )
);

CREATE INDEX idx_video_jobs_book_id ON video_jobs(book_id);
CREATE INDEX idx_video_jobs_status  ON video_jobs(status);

-- ---------------------------------------------------------------------------
-- book_facts: AI-derived analysis attached to a generation job
-- ---------------------------------------------------------------------------
CREATE TABLE book_facts (
    fact_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id         UUID        NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
    job_id          UUID        REFERENCES video_jobs(job_id) ON DELETE SET NULL,
    themes          TEXT[],
    mood            VARCHAR(100),
    target_audience VARCHAR(200),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_book_facts_book_id ON book_facts(book_id);
CREATE INDEX idx_book_facts_job_id  ON book_facts(job_id);

-- ---------------------------------------------------------------------------
-- scene_results: per-scene outputs of a video job
-- ---------------------------------------------------------------------------
CREATE TABLE scene_results (
    scene_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id       UUID        NOT NULL REFERENCES video_jobs(job_id) ON DELETE CASCADE,
    scene_number INT         NOT NULL,
    image_url    TEXT,
    narration    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, scene_number)
);

CREATE INDEX idx_scene_results_job_id ON scene_results(job_id);

-- ---------------------------------------------------------------------------
-- cost_reports: cost tracking per generation job
-- ---------------------------------------------------------------------------
CREATE TABLE cost_reports (
    report_id      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id         UUID         NOT NULL REFERENCES video_jobs(job_id) ON DELETE CASCADE,
    total_cost_usd NUMERIC(10,4),
    breakdown      JSONB,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_cost_reports_job_id ON cost_reports(job_id);
