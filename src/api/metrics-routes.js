import { Router } from 'express';
import pool from '../db/client.js';

const router = Router();

router.get('/metrics/drift', async (req, res) => {
  try {
    const periodDays = parseInt(req.query.period, 10) || 7;
    const cutoff = new Date(Date.now() - periodDays * 86400000);

    const { rows } = await pool.query(
      `SELECT
         COUNT(*) AS sample_count,
         AVG(pl.predicted_priority_score) AS ml_mean,
         AVG(be.generation_priority_score) AS formula_mean,
         AVG(ABS(pl.predicted_priority_score - be.generation_priority_score)) AS ml_mae,
         SQRT(AVG(POWER(pl.predicted_priority_score - be.generation_priority_score, 2))) AS ml_rmse,
         CORR(pl.predicted_priority_score, be.generation_priority_score) AS pearson_r
       FROM ml_prediction_log pl
       JOIN book_did_engagement be ON be.book_id = pl.book_id
      WHERE pl.inference_timestamp >= $1
        AND be.generation_priority_score IS NOT NULL`,
      [cutoff],
    );

    const r = rows[0];
    const sampleCount = parseInt(r.sample_count, 10);
    const mlR2 = r.pearson_r ? r.pearson_r * r.pearson_r : null;
    const formulaR2 = null;
    const winner = sampleCount >= 100 && mlR2 !== null && mlR2 > 0.52 ? 'ml' : 'tie';

    return res.json({
      status: 'ok',
      data: {
        period: `${periodDays}d`,
        sample_count: sampleCount,
        ml_r2: mlR2,
        ml_mae: r.ml_mae ? parseFloat(r.ml_mae) : null,
        ml_rmse: r.ml_rmse ? parseFloat(r.ml_rmse) : null,
        formula_r2: formulaR2,
        formula_mae: null,
        formula_rmse: null,
        pearson_r: r.pearson_r ? parseFloat(r.pearson_r) : null,
        winner,
        last_updated: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('[metrics-drift] error:', err.message);
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

export default router;
