"""Loads the trained susceptibility Transformer once and serves predictions.

Wraps the same logic as src/models/predict_susceptibility.py, but keeps the
checkpoint and normalization stats in memory instead of reloading them on
every call.
"""

import logging
import sys
import threading
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

from src.models.susceptibility_dataset import load_latest_site_windows
from src.models.train_susceptibility_transformer import SusceptibilityTransformer

logger = logging.getLogger(__name__)


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
        self._prediction_cache: dict[tuple[tuple[str, ...], bool], tuple[list[dict], dict[str, str]]] = {}
        self._window_cache: dict[str, np.ndarray] = {}
        self._cache_warming: bool = False
        self._cache_warmed: bool = False

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

    def warm_cache(self, all_site_ids: list[str]) -> None:
        """Pre-load windows for all known sites into `_window_cache` so that
        subsequent predict calls never need to scan the training CSV again.
        Call once at startup after the model and coordinates are loaded.
        """
        if not self.is_loaded or self._features is None:
            logger.warning("Cannot warm cache: model not loaded.")
            return
        if self._cache_warmed or self._cache_warming:
            return

        self._cache_warming = True
        logger.info("Warming window cache for %d sites (background)...", len(all_site_ids))
        try:
            loaded = load_latest_site_windows(
                settings.training_dataset_path,
                all_site_ids,
                window_size=settings.window_size,
                features=self._features,
            )
            for sid, window in loaded.items():
                self._window_cache[sid] = window
            self._cache_warmed = True
            logger.info(
                "Window cache warm: %d/%d sites loaded.",
                len(loaded), len(all_site_ids),
            )
        except Exception:
            logger.exception("Failed to warm window cache.")
        finally:
            self._cache_warming = False

    def warm_cache_async(self, all_site_ids: list[str]) -> None:
        """Start warm_cache in a background daemon thread so the API is
        immediately responsive while the 5.7 GB CSV is scanned once.
        """
        thread = threading.Thread(
            target=self.warm_cache,
            args=(all_site_ids,),
            daemon=True,
            name="cache-warmer",
        )
        thread.start()

    def infer_from_window(self, window: np.ndarray) -> tuple[float, str]:
        """Run the loaded model on an already-fetched window. Shared by the
        full-dataset predict() below and by the demo service, which fetches
        its windows from a small in-memory subset instead of scanning the
        full training CSV.
        """
        if self._model is None or self._mean is None or self._std is None:
            raise ModelNotLoadedError("Model checkpoint is not loaded.")

        normalized = (window - self._mean) / self._std
        with torch.no_grad():
            logit = self._model(torch.from_numpy(normalized[None]))
            probability = float(torch.sigmoid(logit).item())

        return probability, classify_risk(probability)

    def latest_feature_snapshot(self, window: np.ndarray) -> dict[str, float]:
        """The most recent day's raw (unnormalized) feature values, keyed by
        feature name — for a dashboard detail panel, not used in inference.
        """
        if self._features is None:
            raise ModelNotLoadedError("Model checkpoint is not loaded.")
        return dict(zip(self._features, window[-1].tolist()))

    def predict_many(
        self, site_ids: list[str], include_features: bool = False
    ) -> tuple[list[dict], dict[str, str]]:
        """Batch prediction in one dataset scan. Returns lightweight dicts
        the router can turn into Pydantic response objects after region
        normalization is applied in the route layer.

        The service now memoizes warm windows and predictions keyed by the
        normalized site-id tuple and the include_features toggle so the
        dashboard can re-use one pass across repeated viewport requests.
        """
        if self._model is None or self._features is None:
            raise ModelNotLoadedError("Model checkpoint is not loaded.")

        ordered = list(dict.fromkeys(site_ids))
        cache_key = (tuple(sorted(ordered)), include_features)
        if cache_key in self._prediction_cache:
            cached = self._prediction_cache[cache_key]
            return [dict(item) for item in cached[0]], dict(cached[1])

        missing = [sid for sid in ordered if sid not in self._window_cache]
        errors: dict[str, str] = {}
        if missing and not self._cache_warming:
            # Only scan the CSV if the background cache warmer isn't running.
            # Competing scans on the 5.7 GB file would deadlock the server.
            try:
                loaded = load_latest_site_windows(
                    settings.training_dataset_path,
                    missing,
                    window_size=settings.window_size,
                    features=self._features,
                )
            except ValueError as exc:
                raise SiteNotFoundError(str(exc)) from exc
            for sid, window in loaded.items():
                self._window_cache[sid] = window
        elif missing and self._cache_warming:
            for sid in missing:
                errors[sid] = "Cache warming in progress — site will be available shortly."

        results: list[dict] = []
        for site_id in ordered:
            window = self._window_cache.get(site_id)
            if window is None:
                if site_id not in errors:
                    errors[site_id] = f"Site ID not found: {site_id}"
                continue

            probability, risk_class = self.infer_from_window(window)
            snapshot = self.latest_feature_snapshot(window) if include_features else None
            results.append({
                "site_id": site_id,
                "susceptibility_probability": round(probability, 6),
                "risk_class": risk_class,
                "feature_snapshot": snapshot,
            })

        # Only cache the payload if we are not currently warming the cache.
        # If we cache while warming, we will permanently cache the temporary
        # "Cache warming in progress" errors.
        if not self._cache_warming:
            payload = (results, errors)
            self._prediction_cache[cache_key] = payload
            
        return [dict(item) for item in results], dict(errors)

    def predict(
        self, site_id: str, include_features: bool = False
    ) -> tuple[float, str, dict[str, float] | None]:
        if self._model is None or self._features is None:
            raise ModelNotLoadedError("Model checkpoint is not loaded.")

        results, errors = self.predict_many([site_id], include_features=include_features)
        
        if site_id in errors:
            raise SiteNotFoundError(errors[site_id])
        if not results:
            raise SiteNotFoundError(f"Site ID not found: {site_id}")

        result = results[0]
        return result["susceptibility_probability"], result["risk_class"], result.get("feature_snapshot")


# Singleton used by the routers — loaded once in main.py's startup hook.
service = SusceptibilityService()
