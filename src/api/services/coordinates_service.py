"""Small in-memory site_id -> (lat, lon) lookup, built once via
scripts/build_site_coordinates.py and loaded fully into memory at API
startup — coordinates are static per site, so there's no need to touch the
full training dataset on every request just to place a marker.
"""

from pathlib import Path


class CoordinatesService:
    def __init__(self) -> None:
        self._coords: dict[str, tuple[float, float]] = {}

    @property
    def is_loaded(self) -> bool:
        return bool(self._coords)

    def load(self, csv_path: Path) -> None:
        if not csv_path.exists():
            # Don't crash startup if the lookup hasn't been built yet — the
            # geojson endpoints will just report every site as missing
            # coordinates until scripts/build_site_coordinates.py is run.
            return

        import pandas as pd  # local import: only needed if the file exists

        df = pd.read_csv(csv_path)
        self._coords = {
            row.site_id: (float(row.lat), float(row.lon)) for row in df.itertuples()
        }

    def get(self, site_id: str) -> tuple[float, float] | None:
        return self._coords.get(site_id)


# Singleton, loaded once in main.py's startup hook.
coordinates_service = CoordinatesService()