/**
 * Handle video.updated event.
 *
 * Smart DID playback state is stored separately from canonical GACS metadata.
 */
export async function handle(payload, db, queue) {
  const {
    bookId: externalBookId,
    status = null,
    videoUrl = null,
    subtitleUrl = null,
    expiresAt = null,
    retryCount = 0,
    errorMessage = null,
  } = payload.data || {};

  const eventId = payload.eventId;

  try {
    if (!externalBookId) {
      return { status: 'skipped', reason: 'missing_book_id' };
    }

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
      await enqueue(queue, 'reconciliation', {
        bookId: externalBookId,
        eventId,
        occurredAt: payload.occurredAt,
        reason: 'unknown_book_id',
      });

      return {
        status: 'skipped',
        reason: 'unknown_book_id_sent_to_reconciliation',
        enqueued: ['reconciliation'],
      };
    }

    const gacsBookId = refResult.rows[0].book_id;

    const tableCheck = await db.query(
      `SELECT EXISTS (
         SELECT 1
           FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'smart_did_video_state'
       )`,
    );

    if (tableCheck.rows[0].exists) {
      await db.query(
        `INSERT INTO smart_did_video_state (
           book_id,
           status,
           video_url,
           subtitle_url,
           expires_at,
           retry_count,
           error_message,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (book_id)
         DO UPDATE SET
           status = EXCLUDED.status,
           video_url = EXCLUDED.video_url,
           subtitle_url = EXCLUDED.subtitle_url,
           expires_at = EXCLUDED.expires_at,
           retry_count = EXCLUDED.retry_count,
           error_message = EXCLUDED.error_message,
           updated_at = NOW()
         WHERE smart_did_video_state.status IS DISTINCT FROM EXCLUDED.status
            OR smart_did_video_state.video_url IS DISTINCT FROM EXCLUDED.video_url
            OR smart_did_video_state.subtitle_url IS DISTINCT FROM EXCLUDED.subtitle_url
            OR smart_did_video_state.expires_at IS DISTINCT FROM EXCLUDED.expires_at
            OR smart_did_video_state.retry_count IS DISTINCT FROM EXCLUDED.retry_count
            OR smart_did_video_state.error_message IS DISTINCT FROM EXCLUDED.error_message`,
        [gacsBookId, status, videoUrl, subtitleUrl, expiresAt, retryCount, errorMessage],
      );
    }

    await db.query(
      `UPDATE video_jobs
          SET did_reported_status = $2,
              did_request_retries = $3,
              expires_at = $4,
              did_status_synced_at = NOW()
        WHERE job_id = (
          SELECT job_id
            FROM video_jobs
           WHERE book_id = $1
           ORDER BY created_at DESC
           LIMIT 1
        )
        AND (
          did_reported_status IS DISTINCT FROM $2
          OR did_request_retries IS DISTINCT FROM $3
          OR expires_at IS DISTINCT FROM $4
        )`,
      [gacsBookId, status, retryCount, expiresAt],
    );

    if (status === 'failed' && retryCount >= 3) {
      await enqueue(queue, 'video-regeneration', {
        bookId: gacsBookId,
        externalBookId,
        eventId,
        errorMessage,
        retryCount,
      });

      return {
        status: 'ok',
        bookId: gacsBookId,
        enqueued: ['video-regeneration'],
      };
    }

    return { status: 'ok', bookId: gacsBookId };
  } catch (err) {
    console.error(`[video.updated] error: ${err.message}`);
    return { status: 'error_logged' };
  }
}

async function enqueue(queue, jobName, data) {
  const target = resolveQueue(queue, jobName);
  if (!target || typeof target.add !== 'function') return false;

  await target.add(jobName, data);
  return true;
}

function resolveQueue(queue, jobName) {
  if (!queue) return null;
  if (typeof queue.add === 'function') return queue;

  const queueByJob = {
    reconciliation: 'reconciliationQueue',
    'video-regeneration': 'videoRegenerationQueue',
    'video-refresh': 'videoRefreshQueue',
    'sync-alert': 'syncAlertQueue',
    'dead-letter': 'deadLetterQueue',
  };

  return queue[queueByJob[jobName]];
}
