/* Table description: tracks audience consensus/agreement on video labels */
CREATE TABLE audience_validation (
    id BIGSERIAL PRIMARY KEY,
    video_id UUID NOT NULL REFERENCES video_queue(id) ON DELETE CASCADE,
    label_key VARCHAR(100) NOT NULL,
    agreement_score DECIMAL(3, 2) DEFAULT 0,
    validator_count INT DEFAULT 0,
    last_validated_at TIMESTAMP DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_audience_validation_video_label UNIQUE(video_id, label_key),
    CONSTRAINT ck_audience_validation_score CHECK (agreement_score >= 0 AND agreement_score <= 1)
);

CREATE INDEX idx_audience_validation_video_id ON audience_validation(video_id);
CREATE INDEX idx_audience_validation_label_key ON audience_validation(label_key);
CREATE INDEX idx_audience_validation_last_validated ON audience_validation(last_validated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON audience_validation TO gacs_user;

COMMENT ON TABLE audience_validation IS 'Tracks audience consensus/agreement on video labels';
COMMENT ON COLUMN audience_validation.video_id IS 'Foreign key to video_queue table';
COMMENT ON COLUMN audience_validation.label_key IS 'Key for the label being validated';
COMMENT ON COLUMN audience_validation.agreement_score IS 'Consensus score between 0.00 and 1.00';
COMMENT ON COLUMN audience_validation.validator_count IS 'Number of validators who contributed to the score';
