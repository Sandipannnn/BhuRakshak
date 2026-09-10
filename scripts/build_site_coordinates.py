"""Build a tiny site_id -> lat/lon lookup table from the full training dataset.

training_dataset.csv carries lat/lon on every row (constant per site, per
align_timeseries.py / build_training_dataset.py), so scanning the full
~27M-row file on every API request just to plot a marker would be wasteful.
Run this once (and again after re-running the data pipeline) to build a
small lookup that the API loads fully into memory at startup.

Usage (from repo root):
    python scripts/build_site_coordinates.py
"""

from pathlib import Path

import pandas as pd

SOURCE_CSV = Path("data/processed/training_dataset.csv")
OUTPUT_CSV = Path("data/processed/site_coordinates.csv")
CHUNK_SIZE = 250_000


def _resolve_lat_lon_columns(columns: list[str]) -> tuple[str, str]:
    cols = set(columns)
    if "lat" in cols and "lon" in cols:
        return "lat", "lon"
    if "latitude" in cols and "longitude" in cols:
        return "latitude", "longitude"
    raise SystemExit(
        f"Could not find lat/lon columns in {SOURCE_CSV}. "
        f"Available columns: {columns}"
    )


def main() -> None:
    header = pd.read_csv(SOURCE_CSV, nrows=0).columns.tolist()
    lat_col, lon_col = _resolve_lat_lon_columns(header)

    seen: dict[str, tuple[float, float]] = {}
    for chunk in pd.read_csv(
        SOURCE_CSV, usecols=["site_id", lat_col, lon_col], chunksize=CHUNK_SIZE
    ):
        chunk = chunk.dropna(subset=[lat_col, lon_col]).drop_duplicates("site_id")
        for site_id, lat, lon in chunk.itertuples(index=False):
            if site_id not in seen:
                seen[site_id] = (float(lat), float(lon))

    result = pd.DataFrame(
        [{"site_id": s, "lat": v[0], "lon": v[1]} for s, v in seen.items()]
    )
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(OUTPUT_CSV, index=False)
    print(f"Wrote {len(result)} site coordinates to {OUTPUT_CSV}")


if __name__ == "__main__":
    main()