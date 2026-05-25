# Priority Scoring

Priority scoring decides which GACS video job should be generated or refreshed first.

## Formula

The `generation_priority_score` is a weighted composite of 5 signals:

```
generation_priority_score = 40% decayed_request
                            + 30% ranking_score
                            + 15% retry_count
                            + 10% expiry_signal
                            +  5% starvation_signal
```

### Signal Breakdown

| Signal | Weight | Source Column | Description |
|--------|--------|---------------|-------------|
| Decayed request | 40% | `request_count_decayed` | `LN(1 + count) × exp(-ln2/30 × days_elapsed)` — exponential decay, 30-day half-life |
| Ranking score | 30% | `ranking_score` | Relevance from Smart DID (0-1 normalized; > 1 divided by 100) |
| Retry count | 15% | `did_request_retries` | Capped at 10 retries |
| Expiry signal | 10% | `expires_at` | Negative = already expired (urgency) |
| Starvation signal | 5% | `created_at` | Days since created (capped at 7), older gets boost |

### Decay Function

The request count uses exponential decay with a 30-day half-life:

```text
decayed = LN(1 + raw_count) × exp(-ln(2) / 30 × hours_since_last_request / 24)
```

This ensures recent engagement counts more than old engagement.

## Refresh Schedule

- **Automatic**: Every hour via `pg_cron` (migration 009), minute 5 (`5 * * * *`)
- **Manual**: `npm run priority:refresh` runs `scripts/run-refresh-priority-scores.js`

## DISTINCT ON Fix

Migration 008 was fixed to add `DISTINCT ON (book_id)` in the `scored` CTE. This prevents duplicate rows when a book has multiple open `video_jobs` — without it, the scoring function produced non-deterministic results.

```sql
scored AS (
  SELECT DISTINCT ON (be.book_id)
    be.book_id,
    ...
  ORDER BY be.book_id, be.score_last_refreshed_at DESC NULLS LAST
)
```

## ML Augmentation (Sprint 2)

In Sprint 2, an XGBoost model (exported to ONNX) predicts `predicted_priority_score` from 31 feature vector inputs. The A/B experiment compares:

- **Control**: Formula-based `generation_priority_score` (above)
- **Treatment**: ML-predicted `predicted_priority_score`

If ML wins (R² > formula + 0.02), the ML prediction replaces the formula as the canonical sort order. See `docs/a-b-testing.md`.

## Related Files

- Feature definitions: `src/features/feature-registry.json` (see `generation_priority_score`, `request_count_decayed`, `score_freshness_hours`, etc.)
- Scoring function: `db/migrations/008_create_refresh_priority_scores_function_up.sql`
- ML feature computation: `src/features/feature-computation.service.js`
- Inference (ML scoring): `src/ml/inference.worker.js`
