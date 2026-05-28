"""Tests for the ML training pipeline and model registry."""

import base64
import json
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))


class TestModelRegistry:
    def test_registry_creates_dirs(self):
        with tempfile.TemporaryDirectory() as tmp:
            from src.ml.model_registry import ModelRegistry
            reg = ModelRegistry(model_dir=tmp)
            assert Path(tmp).exists()
            assert (Path(tmp) / "archive").exists()

    def test_register_saves_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            from src.ml.model_registry import ModelRegistry
            reg = ModelRegistry(model_dir=tmp)
            reg.register("v1.0", {"r2_score": 0.85}, "0.1.0")
            metadata = reg.load_metadata()
            assert metadata["model_version"] == "v1.0"
            assert metadata["metrics"]["r2_score"] == 0.85
            assert metadata["feature_version"] == "0.1.0"

    def test_save_and_load_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            from src.ml.model_registry import ModelRegistry
            reg = ModelRegistry(model_dir=tmp)
            dummy_bytes = b"onnx_model_content"
            reg.save_model(dummy_bytes)
            loaded = reg.load_model_bytes()
            assert loaded == dummy_bytes

    def test_archive_existing(self):
        with tempfile.TemporaryDirectory() as tmp:
            from src.ml.model_registry import ModelRegistry
            reg = ModelRegistry(model_dir=tmp)
            reg.save_model(b"v1_model")
            reg.register("1.0", {"r2_score": 0.8}, "0.1.0")
            reg.archive_existing()
            reg.save_model(b"v2_model")
            reg.register("2.0", {"r2_score": 0.9}, "0.1.0")
            archived = reg.list_archived_versions()
            assert len(archived) >= 1

    def test_get_latest_version_returns_none_when_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            from src.ml.model_registry import ModelRegistry
            reg = ModelRegistry(model_dir=tmp)
            assert reg.get_latest_version() is None


class TestTrainingPipeline:
    def test_load_training_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "test_data.csv"
            features = [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]
            labels = [10.0, 20.0]
            rows = []
            for f, l in zip(features, labels):
                encoded = base64.b64encode(json.dumps(f).encode()).decode()
                rows.append(f"{encoded},{l}")
            csv_path.write_text("feature_vector,generation_priority_score\n" + "\n".join(rows))

            from src.ml.train_pipeline import load_training_data
            X, y = load_training_data(str(csv_path))
            assert X.shape == (2, 3)
            assert np.allclose(y, [10.0, 20.0])

    def test_load_training_data_raises_on_missing_columns(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "bad.csv"
            csv_path.write_text("foo,bar\n1,2")
            from src.ml.train_pipeline import load_training_data
            with pytest.raises(ValueError, match="Missing required columns"):
                load_training_data(str(csv_path))

    def test_load_training_data_raises_on_empty_after_dropna(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "empty_label.csv"
            features = base64.b64encode(json.dumps([1.0, 2.0]).encode()).decode()
            csv_path.write_text(f"feature_vector,generation_priority_score\n{features},\n")
            from src.ml.train_pipeline import load_training_data
            with pytest.raises(ValueError, match="No rows with non-null"):
                load_training_data(str(csv_path))

    def test_train_model_basic(self):
        np.random.seed(42)
        X = np.random.randn(50, 4).astype(np.float32)
        y = (X[:, 0] * 2 + X[:, 1] * 3 + np.random.randn(50) * 0.1).astype(np.float32)

        from src.ml.train_pipeline import train_model
        model, metrics, X_train, X_test, y_train, y_test = train_model(X, y, test_size=0.2)
        assert metrics["train_samples"] == 40
        assert metrics["test_samples"] == 10
        assert metrics["r2_score"] > 0.5
        assert "mae" in metrics
        assert "rmse" in metrics

    def test_convert_to_onnx(self):
        np.random.seed(42)
        X = np.random.randn(20, 3).astype(np.float32)
        y = (X[:, 0] + X[:, 1] * 2 + np.random.randn(20) * 0.05).astype(np.float32)

        import xgboost as xgb
        model = xgb.XGBRegressor(n_estimators=10, max_depth=3, verbosity=0)
        model.fit(X, y)

        from src.ml.train_pipeline import convert_to_onnx
        onnx_bytes = convert_to_onnx(model, 3)

        import onnx
        onnx_model = onnx.load_model_from_string(onnx_bytes)
        assert onnx_model.ir_version > 0

    def test_end_to_end_training_small(self):
        with tempfile.TemporaryDirectory() as tmp:
            np.random.seed(42)
            n = 30
            X = np.random.randn(n, 4).astype(np.float32)
            y = (X[:, 0] * 1.5 + X[:, 1] * 2.0 + np.random.randn(n) * 0.2).astype(np.float32)

            csv_path = Path(tmp) / "train.csv"
            rows = []
            for f, l in zip(X, y):
                encoded = base64.b64encode(json.dumps(f.tolist()).encode()).decode()
                rows.append(f"{encoded},{l}")
            csv_path.write_text("feature_vector,generation_priority_score\n" + "\n".join(rows))
            model_dir = Path(tmp) / "model_output"

            from src.ml.train_pipeline import main as train_main
            sys.argv = ["train_pipeline.py", "--input", str(csv_path), "--model-dir", str(model_dir), "--model-version", "test-v1"]
            train_main()

            from src.ml.model_registry import ModelRegistry
            reg = ModelRegistry(model_dir=str(model_dir))
            assert reg.model_path.exists()
            metadata = reg.load_metadata()
            assert metadata["model_version"] == "test-v1"
            assert "r2_score" in metadata["metrics"]
