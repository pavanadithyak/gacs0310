"""Evaluation script for GACS ML model.

Compares ML model predictions against ground truth (generation_priority_score)
using test data. Computes R², MAE, MSE, RMSE, and correlation metrics.
"""

import argparse
import json
import sys
import warnings

import numpy as np
import onnxruntime as ort

warnings.filterwarnings("ignore", category=UserWarning)

try:
    from .model_registry import ModelRegistry
    from .train_pipeline import load_training_data
except ImportError:
    from model_registry import ModelRegistry
    from train_pipeline import load_training_data


def compute_correlation(y_true, y_pred):
    n = len(y_true)
    if n < 2:
        return None
    x_mean = np.mean(y_true)
    y_mean = np.mean(y_pred)
    num = np.sum((y_true - x_mean) * (y_pred - y_mean))
    den = np.sqrt(np.sum((y_true - x_mean) ** 2) * np.sum((y_pred - y_mean) ** 2))
    return float(num / den) if den != 0 else None


def compute_metrics(y_true, y_pred):
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

    mae = mean_absolute_error(y_true, y_pred)
    mse = mean_squared_error(y_true, y_pred)
    rmse = float(np.sqrt(mse))
    r2 = r2_score(y_true, y_pred)

    metrics = {
        "r2_score": float(r2),
        "mae": float(mae),
        "mse": float(mse),
        "rmse": rmse,
        "pearson_r": compute_correlation(y_true, y_pred),
        "samples": int(len(y_true)),
    }
    return metrics


def evaluate_onnx_model(onnx_bytes, X_test, y_test):
    session = ort.InferenceSession(onnx_bytes)
    input_name = session.get_inputs()[0].name
    predictions = session.run(None, {input_name: X_test.astype(np.float32)})[0]
    predictions = predictions.flatten()
    return compute_metrics(y_test, predictions)


def evaluate_against_formula(predicted_scores, formula_scores):
    comparison = {
        "ml_better_count": 0,
        "formula_better_count": 0,
        "tie_count": 0,
        "total": len(predicted_scores),
    }
    if len(predicted_scores) == 0 or len(formula_scores) == 0:
        return comparison

    for p, f in zip(predicted_scores, formula_scores):
        diff = abs(p - f)
        if diff < 0.01:
            comparison["tie_count"] += 1
        else:
            p_err = abs(p - np.mean(predicted_scores))
            f_err = abs(f - np.mean(formula_scores))
            if p_err < f_err:
                comparison["ml_better_count"] += 1
            else:
                comparison["formula_better_count"] += 1
    return comparison


def main():
    parser = argparse.ArgumentParser(description="Evaluate ML model against baseline")
    parser.add_argument("--input", default="data/training_data.csv", help="Path to training data CSV")
    parser.add_argument("--model-dir", default="data/models/ml", help="Directory containing model")
    parser.add_argument("--output", default=None, help="Output path for evaluation report JSON")
    args = parser.parse_args()

    registry = ModelRegistry(model_dir=args.model_dir)
    metadata = registry.load_metadata()

    print("[evaluate] Loading training data...")
    X, y = load_training_data(args.input)

    print(f"[evaluate] Loaded {X.shape[0]} samples")

    print("[evaluate] Loading ONNX model...")
    onnx_bytes = registry.load_model_bytes()
    if onnx_bytes is None:
        print("[evaluate] ERROR: No model found")
        sys.exit(1)

    print("[evaluate] Running inference on full dataset...")
    metrics = evaluate_onnx_model(onnx_bytes, X, y)

    print(f"[evaluate] R²: {metrics['r2_score']:.4f}")
    print(f"[evaluate] MAE: {metrics['mae']:.4f}")
    print(f"[evaluate] RMSE: {metrics['rmse']:.4f}")
    print(f"[evaluate] Pearson R: {metrics['pearson_r']:.4f}")
    print(f"[evaluate] Samples: {metrics['samples']}")

    baseline_metrics = metadata.get("metrics", {})
    if baseline_metrics:
        print("\n[evaluate] Comparison with baseline:")
        for key in ("r2_score", "mae", "rmse"):
            prev = baseline_metrics.get(key)
            curr = metrics.get(key)
            if prev is not None and curr is not None:
                direction = "BETTER" if (key == "r2_score" and curr > prev) or (key != "r2_score" and curr < prev) else "WORSE"
                print(f"  {key}: {prev:.4f} -> {curr:.4f} ({direction})")

    report = {
        "evaluation": metrics,
        "model_version": metadata.get("model_version"),
        "feature_version": metadata.get("feature_version"),
        "baseline": baseline_metrics,
        "improved": (
            baseline_metrics.get("r2_score", 0) < metrics.get("r2_score", 0)
            if baseline_metrics.get("r2_score")
            else None
        ),
    }

    if args.output:
        with open(args.output, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\n[evaluate] Report saved to {args.output}")
    else:
        print(json.dumps(report, indent=2))

    print("[evaluate] Evaluation complete.")


if __name__ == "__main__":
    main()
