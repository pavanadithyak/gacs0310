/*
Create priority scoring refresh function.

This function recalculates demand-based generation priority from Smart DID
engagement signals and writes the final score into video_jobs.priority_score.

Signals used:
- book_engagement.request_count
- book_engagement.ranking_score
- book_engagement.last_requested_at
- video_jobs.did_request_retries
- video_jobs.expires_at
- video_jobs.created_at
*/

ALTER TABLE book_engagement
    ADD COLUMN IF NOT EXISTS request_count_decayed NUMERIC(12, 4) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS generation_priority_score NUMERIC(12, 4) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS score_last_refreshed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION refresh_priority_scores()
RETURNS TABLE(rows_updated INT)
LANGUAGE SQL
AS $$
    WITH scored AS (
        SELECT
            be.book_id,

            /*
             * Request signal:
             * - log scale prevents huge request counts from dominating forever
             * - 30-day half-life makes old demand fade over time
             */
            (
                LN(1 + COALESCE(be.request_count, 0))
                * EXP(
                    -LN(2.0) / 30.0
                    * EXTRACT(EPOCH FROM (
                        NOW() - COALESCE(be.last_requested_at, be.created_at, NOW())
                    )) / 86400.0
                )
            ) AS decayed_request_signal,

            /*
             * Ranking signal:
             * Supports both 0-1 and 0-100 Smart DID ranking score formats.
             */
            CASE
                WHEN COALESCE(be.ranking_score, 0) > 1
                    THEN LEAST(be.ranking_score / 100.0, 1.0)
                ELSE GREATEST(COALESCE(be.ranking_score, 0), 0)
            END AS normalized_ranking_score,

            /*
             * Retry signal:
             * Retries are urgency, but capped so they do not dominate forever.
             */
            LEAST(COALESCE(vj.did_request_retries, 0) / 5.0, 1.0) AS retry_signal,

            /*
             * Expiry signal:
             * Expired or soon-to-expire videos should move up.
             */
            CASE
                WHEN vj.expires_at IS NULL THEN 0
                WHEN vj.expires_at <= NOW() THEN 1.0
                WHEN vj.expires_at <= NOW() + INTERVAL '24 hours' THEN 0.75
                WHEN vj.expires_at <= NOW() + INTERVAL '3 days' THEN 0.40
                ELSE 0
            END AS expiry_signal,

            /*
             * Starvation signal:
             * Old pending jobs get a small boost so they are not ignored forever.
             * Full boost after 7 days.
             */
            LEAST(
                EXTRACT(EPOCH FROM (NOW() - COALESCE(vj.created_at, NOW()))) / 604800.0,
                1.0
            ) AS starvation_signal

        FROM book_engagement be
        JOIN video_jobs vj
          ON vj.book_id = be.book_id
        WHERE vj.status NOT IN ('completed', 'cancelled')
          AND (
              be.score_last_refreshed_at IS NULL
              OR be.score_last_refreshed_at < NOW() - INTERVAL '1 hour'
          )
    ),

    updated_engagement AS (
        UPDATE book_engagement be
        SET
            request_count_decayed = scored.decayed_request_signal,

            generation_priority_score =
                  (40 * scored.decayed_request_signal)
                + (30 * scored.normalized_ranking_score)
                + (15 * scored.retry_signal)
                + (10 * scored.expiry_signal)
                + (5  * scored.starvation_signal),

            score_last_refreshed_at = NOW(),
            updated_at = NOW()

        FROM scored
        WHERE be.book_id = scored.book_id
        RETURNING
            be.book_id,
            be.generation_priority_score
    ),

    updated_jobs AS (
        UPDATE video_jobs vj
        SET priority_score = ue.generation_priority_score
        FROM updated_engagement ue
        WHERE vj.book_id = ue.book_id
          AND vj.status NOT IN ('completed', 'cancelled')
          AND (
              vj.priority_score IS DISTINCT FROM ue.generation_priority_score
          )
        RETURNING 1
    )

    SELECT COUNT(*)::INT
    FROM updated_jobs;
$$;

GRANT EXECUTE ON FUNCTION refresh_priority_scores() TO gacs_user;