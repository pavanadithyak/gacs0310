# DID Integration Schema

## Overview

The DID (Dynamic Intelligent Distribution) integration syncs engagement signals from Smart DID's video platform into GACS, enabling priority-based video generation.

**Key Design Decisions:**
- `books.book_id` is UUID (verified in the base books schema)
- All foreign keys to `books(book_id)` use `UUID` type (migrations 001, 007, 011, 013, 014)
- Sync/state table own PKs use `BIGSERIAL` (never shared externally)
- GACS owns canonical book metadata; Smart DID contributes time-series signals only
- Smart DID contributions are **never** used to overwrite canonical fields (title, author, description)

---

## Tables

### `book_did_engagement` (Migration 011)

Core engagement signals for each book's DID presence.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | BIGSERIAL | NO | — | PK (own sequence) |
| `book_id` | **UUID** | NO | — | FK → books(book_id) ON DELETE CASCADE |
| `source_system` | VARCHAR(50) | NO | 'smart_did' | Source identifier |
| `request_count` | INT | NO | 0 | Total Smart DID requests |
| `ranking_score` | NUMERIC(8,4) | NO | 0 | Relevance ranking (0–1) |
| `last_requested_at` | TIMESTAMPTZ | YES | NULL | Last request timestamp |
| `synced_at` | TIMESTAMPTZ | YES | NULL | Last sync timestamp |
| `request_count_decayed` | NUMERIC(12,4) | YES | 0 | Demand with exponential decay |
| `generation_priority_score` | NUMERIC(12,4) | YES | 0 | Computed priority (0–999999.9999) |
| `score_last_refreshed_at` | TIMESTAMPTZ | YES | NULL | Last scorer run |
| `created_at` | TIMESTAMPTZ | NO | NOW() | Row creation |
| `updated_at` | TIMESTAMPTZ | NO | NOW() | Last update |

**Constraints:**
- `uq_book_did_engagement_book` UNIQUE (book_id) — one engagement per book

**Indexes:**
- `idx_book_did_engagement_book_id` (book_id)
- `idx_book_did_engagement_priority_score` (generation_priority_score DESC)
- `idx_book_did_engagement_score_refresh` (score_last_refreshed_at)
- `idx_book_did_engagement_last_requested` (last_requested_at DESC)

---

### `book_external_refs` (Migration 007)

Maps Smart DID external book identifiers to internal GACS UUID book IDs.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | BIGSERIAL | NO | — | PK |
| `book_id` | **UUID** | NO | — | FK → books(book_id) ON DELETE CASCADE |
| `source_system` | VARCHAR(50) | NO | — | e.g. 'smart_did' |
| `external_book_id` | VARCHAR(200) | NO | — | Smart DID's alpas_book_id |
| `first_seen_at` | TIMESTAMPTZ | NO | CURRENT_TIMESTAMP | First mapping |
| `last_seen_at` | TIMESTAMPTZ | NO | CURRENT_TIMESTAMP | Last activity |
| `created_at` | TIMESTAMPTZ | NO | CURRENT_TIMESTAMP | Row creation |
| `updated_at` | TIMESTAMPTZ | NO | CURRENT_TIMESTAMP | Last update |

**Constraints:**
- `uq_book_external_refs_source_external` UNIQUE (source_system, external_book_id)

**Indexes:**
- `idx_book_external_refs_book_id` (book_id)
- `idx_book_external_refs_source_external` (source_system, external_book_id)
- `idx_book_external_refs_last_seen_at` (last_seen_at DESC)

**Data Flow**: Webhook/sync receives `external_book_id` → query this table → get UUID `book_id` → upsert engagement.

---

### `did_sync_state` (Migration 006)

Stores incremental sync cursor and status.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `sync_name` | TEXT | NO | — | PK (e.g. 'smart_did.video_records') |
| `cursor_updated_at` | TIMESTAMPTZ | YES | NULL | Cursor timestamp |
| `cursor_external_id` | TEXT | YES | NULL | Cursor external ID |
| `last_started_at` | TIMESTAMPTZ | YES | NULL | Last sync start |
| `last_success_at` | TIMESTAMPTZ | YES | NULL | Last successful sync |
| `last_error` | TEXT | YES | NULL | Last error message |
| `created_at` | TIMESTAMPTZ | NO | NOW() | Row creation |
| `updated_at` | TIMESTAMPTZ | NO | NOW() | Last update |

**Index:**
- `idx_did_sync_state_last_success_at` (last_success_at DESC)

---

### `did_sync_log` (Migration 003)

Audit trail for sync operations.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | BIGSERIAL | NO | — | PK |
| `source_system` | VARCHAR(50) | NO | — | e.g. 'smart_did' |
| `sync_type` | VARCHAR(50) | NO | — | e.g. 'incremental_sync' |
| `status` | VARCHAR(50) | NO | — | success/failed/skipped |
| `book_id` | UUID | YES | NULL | FK → books(book_id), nullable |
| `external_book_id` | VARCHAR(200) | YES | NULL | External ID |
| `payload_json` | JSONB | YES | NULL | Raw payload |
| `error_message` | TEXT | YES | NULL | Error details |
| `idempotency_key` | TEXT | NO | — | UNIQUE dedup key |
| `synced_at` | TIMESTAMPTZ | NO | NOW() | Sync timestamp |

**Constraints:**
- UNIQUE (idempotency_key)
- CHECK (status IN ('success', 'partial', 'failed'))

**Indexes:**
- `idx_did_sync_log_timestamp` (sync_timestamp DESC)
- `idx_did_sync_log_status` (status)
- `idx_did_sync_log_created_at` (created_at DESC)

---

### `smart_did_video_state` (Migration 013)

Tracks playback state, URLs, and retry information from Smart DID.

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | BIGSERIAL | NO | — | PK |
| `book_id` | **UUID** | NO | — | FK → books(book_id) ON DELETE CASCADE |
| `status` | VARCHAR(50) | YES | — | Video status |
| `video_url` | TEXT | YES | — | Smart DID video URL |
| `subtitle_url` | TEXT | YES | — | Subtitle URL |
| `expires_at` | TIMESTAMPTZ | YES | — | URL expiration |
| `retry_count` | INT | NO | 0 | Retry attempts |
| `error_message` | TEXT | YES | NULL | Last error |
| `created_at` | TIMESTAMPTZ | NO | NOW() | Row creation |
| `updated_at` | TIMESTAMPTZ | NO | NOW() | Last update |

**Constraints:**
- `uq_smart_did_video_state_book` UNIQUE (book_id)

**Indexes:**
- `idx_smart_did_video_state_book_id` (book_id)
- `idx_smart_did_video_state_status` (status)

---

### `book_engagement_snapshots` (Migration 014)

Time-series engagement data (async webhook target).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | BIGSERIAL | NO | — | PK |
| `book_id` | **UUID** | NO | — | FK → books(book_id) ON DELETE CASCADE |
| `source_system` | VARCHAR(50) | NO | — | Source identifier |
| `request_count` | INT | NO | 0 | Request count |
| `ranking_score` | NUMERIC(8,4) | YES | — | Ranking score |
| `last_requested_at` | TIMESTAMPTZ | YES | — | Last request |
| `captured_at` | TIMESTAMPTZ | NO | NOW() | Snapshot time |
| `created_at` | TIMESTAMPTZ | NO | NOW() | Row creation |

**Indexes:**
- `idx_book_engagement_snapshots_book_id` (book_id)
- `idx_book_engagement_snapshots_captured_at` (captured_at DESC)

---

### `book_recommendation_segments` (Migration 014)

Recommendation context from Smart DID (async webhook target).

| Column | Type | Null | Default | Notes |
|--------|------|------|---------|-------|
| `id` | BIGSERIAL | NO | — | PK |
| `book_id` | **UUID** | NO | — | FK → books(book_id) ON DELETE CASCADE |
| `source_system` | VARCHAR(50) | NO | — | Source identifier |
| `age_group` | VARCHAR(50) | YES | — | Curated age segment |
| `sort_order` | VARCHAR(50) | YES | — | Display priority |
| `created_at` | TIMESTAMPTZ | NO | NOW() | Row creation |

**Indexes:**
- `idx_book_recommendation_segments_book_id` (book_id)
- `idx_book_recommendation_segments_age_group` (age_group)

---

## Functions

### `refresh_priority_scores()` (Migration 008)

PostgreSQL function that recomputes `generation_priority_score` and `request_count_decayed` using exponential decay.

**Scheduled via:** `pg_cron` (Migration 009)

---

## Migration Order

```
001: book_engagement (baseline, UUID FK)
002: audience_validation
003: did_sync_log (sync audit trail)
004: engagement columns on books
005: priority on video_jobs
006: did_sync_state (cursor tracking)
007: book_external_refs (UUID FK) ← maps external IDs to UUIDs
008: refresh_priority_scores() function
009: pg_cron schedule for priority scoring
010: priority scoring indexes
011: book_did_engagement (UUID FK) ← main engagement table
012: smart_did video columns on video_jobs
013: smart_did_video_state (UUID FK)
014: async engagement tables (UUID FKs)
```

---

## Known Assumptions (Verify Before Deploy)

1. **`books.book_id` is UUID** — confirmed by the base books schema
2. **`gen_random_uuid()` available** — PostgreSQL 13+ builtin
3. **`pg_cron` extension installed** — required for migration 009
4. **`gacs_user` role exists** — all GRANT statements target this role
5. **`video_jobs` table exists** with `book_id` column — required by migrations 005, 012

---

## Monitoring Queries

### Check sync progress
```sql
SELECT * FROM did_sync_state;
```

### High-priority books awaiting generation
```sql
SELECT book_id, request_count, generation_priority_score
FROM book_did_engagement
ORDER BY generation_priority_score DESC
LIMIT 10;
```

### Stale scores needing refresh
```sql
SELECT book_id, score_last_refreshed_at
FROM book_did_engagement
WHERE score_last_refreshed_at < NOW() - INTERVAL '1 hour'
   OR score_last_refreshed_at IS NULL
ORDER BY score_last_refreshed_at ASC NULLS FIRST
LIMIT 10;
```

---

## Related Files

- **Sync stack**: `src/sync/did/incremental-sync.service.js`, `did-sync.repository.js`, `did-sync.mapper.js`
- **Client**: `src/integrations/smart-did.client.js`
- **Webhooks**: `src/webhooks/events/video.{requested,updated,expired,deleted}.js`
- **Scripts**: `scripts/run-did-incremental-sync.js`, `scripts/run-refresh-priority-scores.js`
