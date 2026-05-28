"""Tests for the ML evaluation script."""

import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


class TestEvaluationMetrics:
    def test_compute_correlation_perfect(self):
        from src.ml.evaluate import compute_correlation
        y_true = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        y_pred = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        r = compute_correlation(y_true, y_pred)
        assert r is not None
        assert abs(r - 1.0) < 1e-6

    def test_compute_correlation_negative(self):
        from src.ml.evaluate import compute_correlation
        y_true = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        y_pred = np.array([5.0, 4.0, 3.0, 2.0, 1.0])
        r = compute_correlation(y_true, y_pred)
        assert r is not None
        assert r < 0

    def test_compute_correlation_returns_none_for_single_sample(self):
        from src.ml.evaluate import compute_correlation
        r = compute_correlation(np.array([1.0]), np.array([2.0]))
        assert r is None

    def test_compute_correlation_zero_denominator(self):
        from src.ml.evaluate import compute_correlation
        r = compute_correlation(np.array([1.0, 1.0, 1.0]), np.array([2.0, 2.0, 2.0]))
        assert r is None

    def test_compute_metrics_basic(self):
        from src.ml.evaluate import compute_metrics
        y_true = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
        y_pred = np.array([1.1, 2.2, 2.9, 4.1, 4.8])
        metrics = compute_metrics(y_true, y_pred)
        assert "r2_score" in metrics
        assert "mae" in metrics
        assert "rmse" in metrics
        assert "pearson_r" in metrics
        assert metrics["samples"] == 5
        assert metrics["mae"] > 0

    def test_compute_metrics_perfect_prediction(self):
        from src.ml.evaluate import compute_metrics
        y_true = np.array([1.0, 2.0, 3.0])
        y_pred = np.array([1.0, 2.0, 3.0])
        metrics = compute_metrics(y_true, y_pred)
        assert metrics["r2_score"] == 1.0
        assert metrics["mae"] == 0.0
        assert metrics["rmse"] == 0.0
        assert abs(metrics["pearson_r"] - 1.0) < 1e-6


class TestEvaluateAgainstFormula:
    def test_evaluate_against_formula_basic(self):
        from src.ml.evaluate import evaluate_against_formula
        result = evaluate_against_formula(
            np.array([0.8, 0.7, 0.9]),
            np.array([0.6, 0.7, 0.5]),
        )
        assert result["total"] == 3
        assert result["tie_count"] >= 1

    def test_evaluate_against_formula_empty(self):
        from src.ml.evaluate import evaluate_against_formula
        result = evaluate_against_formula(np.array([]), np.array([]))
        assert result["total"] == 0


class TestEvaluateONNXModel:
    def test_evaluate_onnx_model_small(self):
        with tempfile.TemporaryDirectory() as tmp:
            np.random.seed(42)
            n = 20
            X = np.random.randn(n, 3).astype(np.float32)
            y = (X[:, 0] * 2 + X[:, 1] + np.random.randn(n) * 0.1).astype(np.float32)

            import xgboost as xgb
            model = xgb.XGBRegressor(n_estimators=10, max_depth=3, verbosity=0)
            model.fit(X, y)

            from onnxmltools.convert import convert_xgboost
            from onnxmltools.convert.common.data_types import FloatTensorType
            onnx_model = convert_xgboost(model, initial_types=[("input", FloatTensorType([None, 3]))])
            onnx_bytes = onnx_model.SerializeToString()

            from src.ml.evaluate import evaluate_onnx_model
            metrics = evaluate_onnx_model(onnx_bytes, X, y)
            assert "r2_score" in metrics
            assert metrics["r2_score"] > 0.5
            assert "pearson_r" in metrics
