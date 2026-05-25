/* Prediction audit log — stores inference results for monitoring, drift detection, and feedback loop */
/* actual_priority_score is populated after video job completion (feedback) */

CREATE TABLE ml_prediction_log (
  id BIGSERIAL PRIMARY KEY,
  book_id UUID NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  model_version VARCHAR(32) NOT NULL,
  predicted_priority_score DECIMAL(8, 5) NOT NULL,
  actual_priority_score DECIMAL(8, 5),
  feature_vector_id BIGINT REFERENCES ml_book_features(id) ON DELETE SET NULL,
  inference_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ml_prediction_log_book_id ON ml_prediction_log(book_id);
CREATE INDEX idx_ml_prediction_log_model_version ON ml_prediction_log(model_version);
CREATE INDEX idx_ml_prediction_log_inference_timestamp ON ml_prediction_log(inference_timestamp DESC);
CREATE INDEX idx_ml_prediction_log_actual_null ON ml_prediction_log(book_id) WHERE actual_priority_score IS NULL;

COMMENT ON COLUMN ml_prediction_log.id IS 'Primary key, auto-incrementing';
COMMENT ON COLUMN ml_prediction_log.book_id IS 'Reference to canonical books table';
COMMENT ON COLUMN ml_prediction_log.model_version IS 'Semver of the ML model version used for inference';
COMMENT ON COLUMN ml_prediction_log.predicted_priority_score IS 'ML model output priority score';
COMMENT ON COLUMN ml_prediction_log.actual_priority_score IS 'Post-hoc actual priority (populated by feedback loop)';
COMMENT ON COLUMN ml_prediction_log.feature_vector_id IS 'Reference to the feature vector used for this prediction';
COMMENT ON COLUMN ml_prediction_log.inference_timestamp IS 'When inference was performed';
COMMENT ON COLUMN ml_prediction_log.created_at IS 'Row creation timestamp';

GRANT SELECT, INSERT, UPDATE, DELETE ON ml_prediction_log TO gacs_user;
GRANT USAGE ON SEQUENCE ml_prediction_log_id_seq TO gacs_user;
