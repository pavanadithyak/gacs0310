/**
 * Handle video.requested event
 * Optimized for < 100ms critical path
 */
export async function handle(payload, db, queue) {
  const {
    bookId: externalBookId,
    requestCount = 0,
    lastRequestedAt = null,
    rankingScore = 0,
    ageGroup = null,
    sortOrder = null,
  } = payload.data || {};

  const eventId = payload.eventId;

  try {
    if (!externalBookId) {
      return { status: 'skipped', reason: 'missing_book_id' };
    }

    // 1. Resolve GACS book_id via book_external_refs
    const refResult = await db.query(
      `SELECT book_id
       FROM book_external_refs
       WHERE source_system = 'smart_did'
         AND external_book_id = $1
       ORDER BY first_seen_at ASC
       LIMIT 1`,
      [externalBookId],
    );

    if (refResult.rows.length === 0) {
      await queue.add('reconciliation', {
        bookId: externalBookId,
        eventId,
        occurredAt: payload.occurredAt,
      });
      return {
        status: 'skipped',
        reason: 'unknown_book_id_sent_to_reconciliation',
        enqueued: ['reconciliation'],
      };
    }

    const gacsBookId = refResult.rows[0].book_id;

    // 2. Upsert into book_did_engagement (DID engagement signal table)
    await db.query(
      `INSERT INTO book_did_engagement (
         book_id,
         source_system,
         request_count,
         ranking_score,
         last_requested_at,
         synced_at,
         created_at,
         updated_at
       )
       VALUES ($1, 'smart_did', $2, $3, $4, NOW(), NOW(), NOW())
       ON CONFLICT (book_id)
       DO UPDATE SET
         source_system = EXCLUDED.source_system,
         request_count = EXCLUDED.request_count,
         ranking_score = EXCLUDED.ranking_score,
         last_requested_at = EXCLUDED.last_requested_at,
         synced_at = NOW(),
         updated_at = NOW()
       WHERE book_did_engagement.request_count IS DISTINCT FROM EXCLUDED.request_count
          OR book_did_engagement.ranking_score IS DISTINCT FROM EXCLUDED.ranking_score
          OR book_did_engagement.last_requested_at IS DISTINCT FROM EXCLUDED.last_requested_at`,
      [gacsBookId, requestCount, rankingScore, lastRequestedAt],
    );

    // 3. Update video_jobs priority score + requested_at (CRITICAL PATH)
    await db.query(
      `UPDATE video_jobs
       SET priority_score = $1,
           requested_at = NOW()
       WHERE book_id = $2
         AND status NOT IN ('completed', 'cancelled')`,
      [rankingScore, gacsBookId],
    );

    // 4. ASYNC: Engagement snapshot job (deferred to keep latency low)
    queue.add('async-engagement', {
      type: 'snapshot',
      data: {
        bookId: gacsBookId,
        sourceSystem: 'smart_did',
        requestCount,
        rankingScore,
        lastRequestedAt,
      },
    }).catch((err) => console.error('[video.requested] Async snapshot job failed:', err.message));

    // 5. ASYNC: Recommendation segment (only if ageGroup present)
    if (ageGroup) {
      queue.add('async-engagement', {
        type: 'recommendation',
        data: {
          bookId: gacsBookId,
          sourceSystem: 'smart_did',
          ageGroup,
          sortOrder,
        },
      }).catch((err) => console.error('[video.requested] Async recommendation job failed:', err.message));
    }

    return {
      status: 'ok',
      bookId: gacsBookId,
      enqueued: ['async-engagement'],
    };
  } catch (err) {
    console.error(`[video.requested] error: ${err.message}`);
    return { status: 'error_logged' };
  }
}
