import { Router } from 'express';
import pool from '../db/client.js';
import { featureComputationQueue } from '../queue/bullmq.client.js';
import { apiKeyAuth } from '../middleware/api-key-auth.js';

const router = Router();

router.get('/predictions/:bookId', async (req, res) => {
  try {
    const { bookId } = req.params;

    const { rows } = await pool.query(
      `SELECT pl.id, pl.book_id, pl.model_version, pl.predicted_priority_score,
              pl.inference_timestamp, pl.feature_vector_id,
              be.generation_priority_score AS formula_score
         FROM ml_prediction_log pl
         LEFT JOIN book_did_engagement be ON be.book_id = pl.book_id
        WHERE pl.book_id = $1
        ORDER BY pl.inference_timestamp DESC
        LIMIT 1`,
      [bookId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', error: 'No prediction found for this book' });
    }

    const r = rows[0];
    return res.json({
      status: 'ok',
      data: {
        book_id: r.book_id,
        model_version: r.model_version,
        prediction_score: parseFloat(r.predicted_priority_score),
        formula_score: r.formula_score ? parseFloat(r.formula_score) : null,
        variance: r.formula_score
          ? parseFloat(r.predicted_priority_score) - parseFloat(r.formula_score)
          : null,
        inferred_at: r.inference_timestamp,
      },
    });
  } catch (err) {
    console.error('[predictions-api] error:', err.message);
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

router.post('/inference/trigger', apiKeyAuth, async (req, res) => {
  try {
    const { book_ids, force_recompute } = req.body || {};

    let bookIds;
    if (Array.isArray(book_ids) && book_ids.length > 0) {
      bookIds = book_ids;
    } else {
      const { rows } = await pool.query(
        `SELECT DISTINCT vj.book_id
           FROM video_jobs vj
          WHERE vj.status IN ('pending', 'active')`,
      );
      bookIds = rows.map(r => r.book_id);
    }

    if (bookIds.length === 0) {
      return res.json({ status: 'ok', data: { job_id: null, queued_count: 0, book_ids: [] } });
    }

    const job = await featureComputationQueue.add(
      'manual-inference-trigger',
      { batch: bookIds, force_recompute: !!force_recompute },
      { attempts: 1 },
    );

    return res.json({
      status: 'ok',
      data: {
        job_id: job.id,
        queued_count: bookIds.length,
        book_ids: bookIds,
      },
    });
  } catch (err) {
    console.error('[inference-trigger] error:', err.message);
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

export default router;
