/* Materialized ML feature vector table — single JSONB column per book_id per computation run */
/* Features are derived from source tables (book_did_engagement, smart_did_video_state, etc.) via FeatureComputationService */

CREATE TABLE ml_book_features (
  id BIGSERIAL PRIMARY KEY,
  book_id UUID NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  features JSONB NOT NULL,
  feature_version VARCHAR(32) NOT NULL DEFAULT '0.1.0',
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ml_book_features_book_id ON ml_book_features(book_id);
CREATE INDEX idx_ml_book_features_computed_at ON ml_book_features(computed_at DESC);
CREATE INDEX idx_ml_book_features_feature_version ON ml_book_features(feature_version);

COMMENT ON COLUMN ml_book_features.id IS 'Primary key, auto-incrementing';
COMMENT ON COLUMN ml_book_features.book_id IS 'Reference to canonical books table';
COMMENT ON COLUMN ml_book_features.features IS 'JSONB vector of all 38 computed feature values';
COMMENT ON COLUMN ml_book_features.feature_version IS 'Semver of the feature computation pipeline';
COMMENT ON COLUMN ml_book_features.computed_at IS 'When this feature vector was computed';
COMMENT ON COLUMN ml_book_features.created_at IS 'Row creation timestamp';
COMMENT ON COLUMN ml_book_features.updated_at IS 'Last update timestamp';

GRANT SELECT, INSERT, UPDATE, DELETE ON ml_book_features TO gacs_user;
GRANT USAGE ON SEQUENCE ml_book_features_id_seq TO gacs_user;
