# A/B Experiment: ML vs Formula Priority Scoring

## Goal

Determine whether the **ML-predicted priority score** outperforms the **formula-based `generation_priority_score`** for ranking video job generation.

## Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| R² (coefficient of determination) | Proportion of variance explained | ML R² > formula R² + 0.02 |
| MAE (mean absolute error) | Average prediction error | Lower is better |
| RMSE (root mean squared error) | Penalizes large errors | Lower is better |
| Pearson r | Linear correlation | Closer to 1 is better |

## Design

- **Population**: All books with `video_jobs.status IN ('pending', 'active')`
- **Control**: Formula-based `generation_priority_score` (existing scoring function)
- **Treatment**: ML-predicted `predicted_priority_score` (from `ml_prediction_log`)
- **Duration**: 7-14 days
- **Decision gate**: End of experiment period

## Success Criteria

```
ML wins if:  ML R² > formula R² + 0.02
             AND sample_count >= 100
             AND no regressions in MAE/RMSE > 10%
```

Otherwise, continue using the formula.

## Monitoring

APIs for monitoring the experiment:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/predictions/:bookId` | Per-book prediction vs formula |
| `GET /api/metrics/drift?period=7d` | Experiment dashboard |
| `POST /api/inference/trigger` | Manual re-run inference |

See `docs/api-standards.md` for usage.

## Timeline

| Phase | Duration | Activity |
|-------|----------|---------|
| Setup | Day 1 | Deploy inference worker + APIs |
| Run | 7-14 days | Collect predictions + formula scores |
| Analyze | Day after | Compare via GET /api/metrics/drift |
| Decide | Day after | Promote ML or revert to formula |

## Data Storage

- ML predictions: `ml_prediction_log` table
- Formula scores: `book_did_engagement.generation_priority_score`
- Feature vectors: `ml_book_features` table
- Experiment audit: `ml_prediction_log.model_version` identifies which model produced each prediction

## Related Files

- Feature computation: `src/features/feature-computation.service.js`
- Inference: `src/ml/inference.worker.js`
- API endpoints: `src/api/inference-routes.js`, `src/api/metrics-routes.js`
- Training pipeline: `src/ml/train_pipeline.py`
- Experiment tracking: `GET /api/metrics/drift` dashboard
