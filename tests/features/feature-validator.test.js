import { describe, expect, jest, test } from '@jest/globals';

const MOCK_REGISTRY = {
  version: '0.1.0',
  features: [
    { feature_name: 'numeric_feat', feature_type: 'numeric', nullable: false },
    { feature_name: 'nullable_numeric', feature_type: 'numeric', nullable: true },
    { feature_name: 'scenario_state', feature_type: 'categorical', nullable: false },
    { feature_name: 'video_has_error', feature_type: 'boolean', nullable: false },
  ],
};

jest.unstable_mockModule('../../src/features/feature-registry.json', () => ({ default: MOCK_REGISTRY }));

let FeatureValidator;

beforeAll(async () => {
  const mod = await import('../../src/features/feature-validator.js');
  FeatureValidator = mod.FeatureValidator;
});

describe('FeatureValidator', () => {
  let validator;

  beforeEach(() => {
    validator = new FeatureValidator();
  });

  test('accepts a valid feature vector', () => {
    const vector = {
      numeric_feat: 42,
      nullable_numeric: null,
      scenario_state: 'completed',
      video_has_error: false,
    };
    const result = validator.validate(vector);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('accepts vector with nullable numeric as null', () => {
    const vector = {
      numeric_feat: 0,
      nullable_numeric: null,
      scenario_state: 'pending',
      video_has_error: true,
    };
    expect(validator.validate(vector).valid).toBe(true);
  });

  test('rejects non-nullable numeric that is null', () => {
    const vector = {
      numeric_feat: null,
      nullable_numeric: 5,
      scenario_state: 'pending',
      video_has_error: false,
    };
    const result = validator.validate(vector);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('numeric_feat');
    expect(result.errors[0]).toContain('non-null');
  });

  test('rejects NaN value for numeric', () => {
    const vector = {
      numeric_feat: NaN,
      nullable_numeric: 5,
      scenario_state: 'pending',
      video_has_error: false,
    };
    const result = validator.validate(vector);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('NaN');
  });

  test('rejects Infinity value for numeric', () => {
    const vector = {
      numeric_feat: Infinity,
      nullable_numeric: 5,
      scenario_state: 'pending',
      video_has_error: false,
    };
    const result = validator.validate(vector);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Infinity');
  });

  test('rejects string for numeric field', () => {
    const vector = {
      numeric_feat: '42',
      nullable_numeric: 5,
      scenario_state: 'pending',
      video_has_error: false,
    };
    const result = validator.validate(vector);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('expected number');
  });

  test('rejects missing feature', () => {
    const vector = {
      numeric_feat: 1,
      nullable_numeric: null,
      video_has_error: false,
    };
    const result = validator.validate(vector);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Missing'))).toBe(true);
    expect(result.errors[0]).toContain('scenario_state');
  });

  test('rejects unknown feature', () => {
    const vector = {
      numeric_feat: 1,
      nullable_numeric: null,
      scenario_state: 'active',
      video_has_error: false,
      unknown_feat: 'oops',
    };
    const result = validator.validate(vector);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unknown'))).toBe(true);
  });

  test('rejects null/undefined vector', () => {
    expect(validator.validate(null).valid).toBe(false);
    expect(validator.validate(undefined).valid).toBe(false);
  });

  test('rejects number for boolean field', () => {
    const vector = {
      numeric_feat: 1,
      nullable_numeric: null,
      scenario_state: 'active',
      video_has_error: 1,
    };
    const result = validator.validate(vector);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('expected boolean');
  });

  test('rejects number for categorical field', () => {
    const vector = {
      numeric_feat: 1,
      nullable_numeric: null,
      scenario_state: 42,
      video_has_error: false,
    };
    const result = validator.validate(vector);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('expected string');
  });

  test('emits warnings for count mismatch but still validates individual features', () => {
    const vector = {
      numeric_feat: 1,
      nullable_numeric: null,
      scenario_state: 'active',
      video_has_error: false,
      extra_feat: 99,
    };
    const result = validator.validate(vector);
    const hasCountWarning = result.warnings.some(w => w.includes('count mismatch'));
    const hasUnknownError = result.errors.some(e => e.includes('Unknown'));
    expect(hasCountWarning).toBe(true);
    expect(hasUnknownError).toBe(true);
  });
});
