"""Fast, in-memory prediction path for a small fixed set of demo sites.

The full dataset (training_dataset.csv, ~27M rows) is scanned per request in
model_service.py — fine for the heatmap/full pipeline, too slow for a live
demo. This service loads a small pre-built subset (N sites x ~1 year) fully
into memory once at startup, so demo lookups are instant. It reuses the same
loaded model/normalization stats from model_service.service — predictions
are identical, only the data-fetch path differs.

Build the subset CSV with scripts/build_demo_subset.py before starting the
API in demo mode.
"""

from pathlib import Path

import numpy as np
import pandas as pd

from src.api.services.model_service import SiteNotFoundError


class DemoDatasetNotLoadedError(RuntimeError):
    """Raised when a demo lookup happens before the demo subset loads."""


class DemoSusceptibilityService:
    def __init__(self) -> None:
        self._windows: dict[str, np.ndarray] = {}

    @property
    def is_loaded(self) -> bool:
        return bool(self._windows)

    @property
    def site_ids(self) -> list[str]:
        return sorted(self._windows)

    def load(
        self,
        csv_path: Path,
        features: list[str],
        window_size: int,
    ) -> None:
        """Load the demo subset CSV into memory. Call once at API startup,
        after model_service.service.load() so `features` is available.
        """
        if not csv_path.exists():
            # Don't crash startup if the demo subset hasn't been built yet —
            # /demo/sites will just report an empty list.
            return

        df = pd.read_csv(csv_path, parse_dates=["date"], low_memory=False)
        windows: dict[str, np.ndarray] = {}
        for site_id, group in df.groupby("site_id"):
            group = group.sort_values("date")
            if len(group) < window_size:
                continue
            values = group[features].tail(window_size).to_numpy(dtype=np.float32)
            windows[site_id] = np.nan_to_num(values, nan=0.0, posinf=0.0, neginf=0.0)

        self._windows = windows

    def get_window(self, site_id: str) -> np.ndarray:
        if site_id not in self._windows:
            raise SiteNotFoundError(
                f"'{site_id}' is not in the current demo site list. "
                f"Available: {self.site_ids}"
            )
        return self._windows[site_id]


# Singleton used by the demo router — loaded once in main.py's startup hook.
demo_service = DemoSusceptibilityService()