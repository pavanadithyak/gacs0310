import registry from './feature-registry.json' with { type: 'json' };

const FEATURES = registry.features;
const EXPECTED_NAMES = new Set(FEATURES.map(f => f.feature_name));
const NON_NULLABLE = new Set(FEATURES.filter(f => !f.nullable).map(f => f.feature_name));
const BOOLEAN_FEATURES = new Set(FEATURES.filter(f => f.feature_type === 'boolean').map(f => f.feature_name));
const CATEGORICAL_FEATURES = new Set(FEATURES.filter(f => f.feature_type === 'categorical').map(f => f.feature_name));

export class FeatureValidator {
  validate(featureVector) {
    if (!featureVector || typeof featureVector !== 'object') {
      return { valid: false, errors: ['Feature vector is null, undefined, or not an object'], warnings: [] };
    }

    const errors = [];
    const warnings = [];
    const actualNames = Object.keys(featureVector);

    if (actualNames.length !== FEATURES.length) {
      warnings.push(`Feature count mismatch: expected ${FEATURES.length}, got ${actualNames.length}`);
    }

    for (const name of actualNames) {
      if (!EXPECTED_NAMES.has(name)) {
        errors.push(`Unknown feature: ${name}`);
      }
    }

    for (const feat of FEATURES) {
      if (!(feat.feature_name in featureVector)) {
        errors.push(`Missing feature: ${feat.feature_name}`);
        continue;
      }
      this._validateFeature(feat, featureVector[feat.feature_name], errors);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  _validateFeature(feat, value, errors) {
    if (value === null || value === undefined) {
      if (NON_NULLABLE.has(feat.feature_name)) {
        errors.push(`${feat.feature_name}: expected non-null value but got ${JSON.stringify(value)}`);
      }
      return;
    }

    switch (feat.feature_type) {
      case 'numeric':
        this._validateNumeric(feat, value, errors);
        break;
      case 'boolean':
        this._validateBoolean(feat, value, errors);
        break;
      case 'categorical':
        this._validateCategorical(feat, value, errors);
        break;
      default:
        break;
    }
  }

  _validateNumeric(feat, value, errors) {
    if (typeof value !== 'number') {
      errors.push(`${feat.feature_name}: expected number, got ${typeof value}`);
      return;
    }
    if (!Number.isFinite(value)) {
      errors.push(`${feat.feature_name}: value is ${value} (NaN/Infinity)`);
    }
  }

  _validateBoolean(feat, value, errors) {
    if (typeof value !== 'boolean') {
      errors.push(`${feat.feature_name}: expected boolean, got ${typeof value}`);
    }
  }

  _validateCategorical(feat, value, errors) {
    if (typeof value !== 'string') {
      errors.push(`${feat.feature_name}: expected string, got ${typeof value}`);
    }
  }
}
