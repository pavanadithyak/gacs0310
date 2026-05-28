"""Python training pipeline for GACS ML Feature Store.

Reads training_data.csv (exported by npm run ml:export), trains an XGBoost
regressor, converts to ONNX, and registers the model via ModelRegistry.
"""

import argparse
import base64
import json
import sys
import warnings
from io import StringIO
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

try:
    from .model_registry import ModelRegistry
except ImportError:
    from model_registry import ModelRegistry

warnings.filterwarnings("ignore", category=UserWarning)


def load_training_data(csv_path):
    df = pd.read_csv(csv_path)
    required_cols = {"feature_vector", "generation_priority_score"}
    missing = required_cols - set(df.columns)
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    df = df.dropna(subset=["generation_priority_score"])
    if df.empty:
        raise ValueError("No rows with non-null generation_priority_score")

    features = []
    for vec_str in df["feature_vector"]:
        decoded = base64.b64decode(vec_str)
        arr = json.loads(decoded)
        features.append(arr)

    X = np.array(features, dtype=np.float32)
    y = df["generation_priority_score"].values.astype(np.float32)

    if X.shape[0] == 0:
        raise ValueError("Feature array is empty after decoding")

    return X, y


def train_model(X, y, test_size=0.2, random_state=42):
    import xgboost as xgb

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=random_state,
    )

    model = xgb.XGBRegressor(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=random_state,
        verbosity=0,
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    metrics = {
        "r2_score": float(r2_score(y_test, y_pred)),
        "mae": float(mean_absolute_error(y_test, y_pred)),
        "mse": float(mean_squared_error(y_test, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_test, y_pred))),
        "test_samples": int(len(y_test)),
        "train_samples": int(len(y_train)),
    }

    return model, metrics, X_train, X_test, y_train, y_test


def convert_to_onnx(model, feature_count):
    from onnxmltools.convert import convert_xgboost
    from onnxmltools.convert.common.data_types import FloatTensorType
    initial_type = [("input", FloatTensorType([None, feature_count]))]
    onnx_model = convert_xgboost(model, initial_types=initial_type)
    return onnx_model.SerializeToString()


def main():
    parser = argparse.ArgumentParser(description="Train XGBoost model for priority score prediction")
    parser.add_argument("--input", default="data/training_data.csv", help="Path to training data CSV")
    parser.add_argument("--model-dir", default="data/models/ml", help="Directory for model output")
    parser.add_argument("--feature-version", default="0.1.0", help="Feature registry version used")
    parser.add_argument("--test-size", type=float, default=0.2, help="Test split ratio")
    parser.add_argument("--model-version", default=None, help="Override model version string")
    args = parser.parse_args()

    registry = ModelRegistry(model_dir=args.model_dir)

    print(f"[train] Loading training data from {args.input}")
    X, y = load_training_data(args.input)
    print(f"[train] Loaded {X.shape[0]} samples with {X.shape[1]} features")

    print(f"[train] Training XGBoost model (test_size={args.test_size})")
    model, metrics, X_train, X_test, y_train, y_test = train_model(X, y, test_size=args.test_size)

    print(f"[train] Training metrics: R²={metrics['r2_score']:.4f}, MAE={metrics['mae']:.4f}, RMSE={metrics['rmse']:.4f}")
    print(f"[train] Train samples: {metrics['train_samples']}, Test samples: {metrics['test_samples']}")

    print("[train] Converting to ONNX...")
    onnx_bytes = convert_to_onnx(model, X.shape[1])

    print("[train] Archiving previous model...")
    registry.archive_existing()

    print("[train] Saving model...")
    registry.save_model(onnx_bytes)

    import time
    model_version = args.model_version or f"0.1.0-{int(time.time())}"
    registry.register(
        model_version=model_version,
        metrics=metrics,
        feature_version=args.feature_version,
    )

    print(f"[train] Model registered: {model_version}")
    print(f"[train] Model saved to {registry.model_path}")
    print("[train] Training complete.")


if __name__ == "__main__":
    main()
