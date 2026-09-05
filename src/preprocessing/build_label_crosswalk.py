"""
BhuRakshak — Landslide Label Crosswalk
========================================

Matches master_landslide_points_ner.csv (ground-truth landslide labels:
ls_type, trigger, date, source, state) to the satellite pipeline's own
site_id scheme (e.g. 'arunachal_pradesh_0050') by NEAREST COORDINATE.

Why coordinate matching, not ID matching: the master CSV uses
'point_00001'-style IDs while the satellite CSVs use state-name + index
IDs — confirmed to be two unrelated numbering schemes with no direct
correspondence. Both files carry real lat/lon, so distance is the only
reliable join key.

Output
------
data/processed/label_crosswalk.csv
    One row per satellite site_id, with the nearest master point's
    ls_type / trigger / date / source / state, plus match_distance_m and
    a `matched` boolean (True if within --max-distance-m) so unreliable
    matches can be filtered out before training.

Usage
-----
    python build_label_crosswalk.py
    python build_label_crosswalk.py --max-distance-m 250
"""

import argparse
import glob
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

REPO_ROOT = Path(__file__).resolve().parents[2]  # src/preprocessing -> repo root
RAW_LANDSLIDE_CSV = REPO_ROOT / "data" / "raw" / "landslide" / "master_landslide_points_ner.csv"
RAW_SATELLITE_DIR = REPO_ROOT / "data" / "raw" / "satellite"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"

EARTH_RADIUS_M = 6371000.0


def latlon_to_xy(lat, lon, lat0_rad):
    """Cheap equirectangular projection to meters — accurate enough for
    nearest-neighbor matching over a region the size of Northeast India."""
    lat_rad = np.radians(lat)
    lon_rad = np.radians(lon)
    x = EARTH_RADIUS_M * lon_rad * np.cos(lat0_rad)
    y = EARTH_RADIUS_M * lat_rad
    return x, y


def load_master_points() -> pd.DataFrame:
    if not RAW_LANDSLIDE_CSV.exists():
        raise FileNotFoundError(f"Could not find {RAW_LANDSLIDE_CSV}")
    df = pd.read_csv(RAW_LANDSLIDE_CSV)
    df.columns = [c.strip().lower() for c in df.columns]

    required = ["site_id", "lat", "lon"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"master CSV missing {missing}. Found: {list(df.columns)}")

    df = df.rename(columns={"site_id": "master_site_id"})
    keep = ["master_site_id", "lat", "lon"] + \
           [c for c in ("ls_type", "trigger", "date", "source", "state") if c in df.columns]
    df = df[keep].drop_duplicates(subset="master_site_id").reset_index(drop=True)
    return df


def load_satellite_site_coords() -> pd.DataFrame:
    """
    One (site_id, lat, lon) row per satellite site.

    Dedups WITHIN each file before concatenating so this never holds the
    full multi-million-row satellite tables in memory — we only need one
    representative coordinate per site, not every observation.
    """
    csv_paths = sorted(glob.glob(str(RAW_SATELLITE_DIR / "*.csv")))
    if not csv_paths:
        raise FileNotFoundError(f"No CSVs found in {RAW_SATELLITE_DIR}")

    frames = []
    for path in csv_paths:
        try:
            df = pd.read_csv(path, usecols=lambda c: c.lower().strip() in ("site", "lat", "lon"))
        except ValueError:
            continue  # file doesn't have all three columns — skip it
        df.columns = [c.strip().lower() for c in df.columns]
        if not {"site", "lat", "lon"}.issubset(df.columns):
            continue
        df = df.rename(columns={"site": "site_id"})
        df["site_id"] = df["site_id"].str.lower()
        df = df.drop_duplicates(subset="site_id")
        frames.append(df)

    if not frames:
        raise FileNotFoundError(
            f"None of the CSVs in {RAW_SATELLITE_DIR} had site/lat/lon columns."
        )

    combined = pd.concat(frames, ignore_index=True)
    # A site can appear in multiple files (S1 batch + S2 batch) — average
    # any tiny float differences, coordinates should already agree.
    site_coords = combined.groupby("site_id", as_index=False)[["lat", "lon"]].mean()
    return site_coords


def build_crosswalk(max_distance_m: float) -> pd.DataFrame:
    print("[1/3] Loading master landslide points...")
    master_df = load_master_points()
    print(f"      {len(master_df):,} master points loaded")

    print("[2/3] Loading satellite site coordinates...")
    sat_coords = load_satellite_site_coords()
    print(f"      {len(sat_coords):,} satellite sites loaded")

    print("[3/3] Matching by nearest coordinate...")
    lat0_rad = np.radians(pd.concat([master_df["lat"], sat_coords["lat"]]).mean())

    mx, my = latlon_to_xy(master_df["lat"].values, master_df["lon"].values, lat0_rad)
    sx, sy = latlon_to_xy(sat_coords["lat"].values, sat_coords["lon"].values, lat0_rad)

    tree = cKDTree(np.column_stack([mx, my]))
    dist, idx = tree.query(np.column_stack([sx, sy]), k=1)

    result = sat_coords.copy()
    result["match_distance_m"] = dist
    matched_master = master_df.iloc[idx].reset_index(drop=True)
    for col in matched_master.columns:
        if col in ("lat", "lon"):
            continue  # keep the satellite site's own coordinates, not master's
        result[col] = matched_master[col].values

    result["matched"] = result["match_distance_m"] <= max_distance_m

    n_matched = int(result["matched"].sum())
    n_total = len(result)
    print(f"\n{'='*60}")
    print(f"  Matched within {max_distance_m:.0f}m: {n_matched:,}/{n_total:,} "
          f"({100*n_matched/n_total:.1f}%)")
    print(f"  Distance percentiles (m): "
          f"p50={np.percentile(dist,50):.1f}  p90={np.percentile(dist,90):.1f}  "
          f"p99={np.percentile(dist,99):.1f}  max={dist.max():.1f}")
    print(f"{'='*60}")

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Match satellite sites to master landslide labels by nearest coordinate."
    )
    parser.add_argument("--max-distance-m", type=float, default=250.0,
                        help="Matches farther than this are flagged matched=False (default: 250m)")
    args = parser.parse_args()

    result = build_crosswalk(args.max_distance_m)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out_path = PROCESSED_DIR / "label_crosswalk.csv"
    result.to_csv(out_path, index=False)
    print(f"\nSaved crosswalk to {out_path}")

    unmatched = int((~result["matched"]).sum())
    if unmatched:
        print(f"\n[!] {unmatched:,} satellite sites had no master point within "
              f"{args.max_distance_m:.0f}m — inspect label_crosswalk.csv and filter "
              f"matched==False before using labels for training.")


if __name__ == "__main__":
    main()