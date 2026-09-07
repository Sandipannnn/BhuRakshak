"""Loads the trained susceptibility Transformer once and serves predictions.

Wraps the same logic as src/models/predict_susceptibility.py, but keeps the
checkpoint and normalization stats in memory instead of reloading them on
every call.
"""

import sys
from pathlib import Path

import numpy as np
import torch

from src.api.config import settings

# src/models/train_susceptibility_transformer.py and susceptibility_dataset.py
# use bare imports of each other (`from susceptibility_dataset import ...`),
# written for running those scripts directly from inside src/models/. Add
# that folder to sys.path so the same modules import cleanly here too,
# without touching the existing training/prediction scripts.
_MODELS_DIR = Path(__file__).resolve().parents[2] / "models"
if str(_MODELS_DIR) not in sys.path:
    sys.path.insert(0, str(_MODELS_DIR))

from susceptibility_dataset import load_latest_site_window  # noqa: E402
from train_susceptibility_transformer import SusceptibilityTransformer  # noqa: E402


def classify_risk(probability: float) -> str:
    if probability < 0.33:
        return "Low"
    if probability < 0.67:
        return "Medium"
    return "High"


class ModelNotLoadedError(RuntimeError):
    """Raised when a prediction is requested before the checkpoint loads."""


class SiteNotFoundError(ValueError):
    """Raised when a site_id has no complete window in the dataset."""


class SusceptibilityService:
    def __init__(self) -> None:
        self._model: SusceptibilityTransformer | None = None
        self._features: list[str] | None = None
        self._mean: np.ndarray | None = None
        self._std: np.ndarray | None = None

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    @property
    def features(self) -> list[str] | None:
        return self._features

    def load(self, checkpoint_path: Path | None = None) -> None:
        """Load the checkpoint into memory. Call once at API startup."""
        path = checkpoint_path or settings.checkpoint_path
        if not path.exists():
            # Don't crash the app if the checkpoint isn't present yet (e.g.
            # first boot before training artifacts are copied in) — /health
            # will report model_loaded=False instead.
            return

        checkpoint = torch.load(path, map_location="cpu", weights_only=False)
        self._features = checkpoint["features"]
        self._mean = np.asarray(checkpoint["feature_mean"], dtype=np.float32)
        self._std = np.asarray(checkpoint["feature_std"], dtype=np.float32)

        model = SusceptibilityTransformer(len(self._features))
        model.load_state_dict(checkpoint["model"])
        model.eval()
        self._model = model

    def predict(self, site_id: str) -> tuple[float, str]:
        if self._model is None or self._features is None:
            raise ModelNotLoadedError("Model checkpoint is not loaded.")

        try:
            window = load_latest_site_window(
                settings.training_dataset_path,
                site_id,
                window_size=settings.window_size,
                features=self._features,
            )
        except ValueError as exc:
            raise SiteNotFoundError(str(exc)) from exc

        window = (window - self._mean) / self._std
        with torch.no_grad():
            logit = self._model(torch.from_numpy(window[None]))
            probability = float(torch.sigmoid(logit).item())

        return probability, classify_risk(probability)


# Singleton used by the routers — loaded once in main.py's startup hook.
service = SusceptibilityService()
