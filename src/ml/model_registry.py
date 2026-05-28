"""Model registry for versioned ML model artifact storage."""

import json
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_MODEL_DIR = Path("data/models/ml")
METADATA_FILE = "metadata.json"
MODEL_FILE = "model.onnx"
ARCHIVE_DIR = "archive"


class ModelRegistry:
    """Manages versioned ML model artifacts with metadata tracking.

    Stores the current model as model.onnx + metadata.json in model_dir.
    Archives historical models into the archive/ subdirectory.
    """

    def __init__(self, model_dir=None):
        self.model_dir = Path(model_dir or DEFAULT_MODEL_DIR)
        self.model_dir.mkdir(parents=True, exist_ok=True)
        (self.model_dir / ARCHIVE_DIR).mkdir(parents=True, exist_ok=True)

    @property
    def model_path(self):
        return self.model_dir / MODEL_FILE

    @property
    def metadata_path(self):
        return self.model_dir / METADATA_FILE

    def get_latest_version(self):
        metadata = self.load_metadata()
        if not metadata:
            return None
        return metadata.get("model_version")

    def load_metadata(self):
        if not self.metadata_path.exists():
            return {}
        with open(self.metadata_path, "r") as f:
            return json.load(f)

    def save_metadata(self, metadata):
        with open(self.metadata_path, "w") as f:
            json.dump(metadata, f, indent=2, default=str)

    def archive_existing(self):
        if not self.model_path.exists():
            return
        metadata = self.load_metadata()
        version = metadata.get("model_version", "unknown")
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        archive_stem = f"{timestamp}_v{version}"

        shutil.copy2(self.model_path, self.model_dir / ARCHIVE_DIR / f"{archive_stem}.onnx")
        if self.metadata_path.exists():
            shutil.copy2(self.metadata_path, self.model_dir / ARCHIVE_DIR / f"{archive_stem}_metadata.json")

    def register(self, model_version, metrics, feature_version, training_date=None):
        training_date = training_date or datetime.now(timezone.utc).isoformat()
        metadata = {
            "model_version": model_version,
            "feature_version": feature_version,
            "training_date": training_date,
            "metrics": metrics,
            "registered_at": datetime.now(timezone.utc).isoformat(),
        }
        self.save_metadata(metadata)
        return metadata

    def save_model(self, onnx_model_bytes):
        with open(self.model_path, "wb") as f:
            f.write(onnx_model_bytes)

    def load_model_bytes(self):
        if not self.model_path.exists():
            return None
        with open(self.model_path, "rb") as f:
            return f.read()

    def list_archived_versions(self):
        archive_dir = self.model_dir / ARCHIVE_DIR
        if not archive_dir.exists():
            return []
        versions = []
        for f in sorted(archive_dir.glob("*_metadata.json")):
            with open(f) as fh:
                versions.append(json.load(fh))
        return versions
