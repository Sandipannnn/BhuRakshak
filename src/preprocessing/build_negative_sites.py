"""
BhuRakshak — Negative Site Sampling
=====================================

Generates background ("no recorded landslide") coordinates to serve as the
negative/contrast class for the risk-prediction transformer.

Why this exists: master_landslide_points_ner.csv is a landslide-OCCURRENCE
inventory — every point in it is somewhere a landslide already happened.
There is no "stable slope" example anywhere in that data. A model trained
only on positives has nothing to contrast against and can't learn what
"low risk" looks like. This script samples real coordinates elsewhere in
the same terrain so they can be run through the exact same GEE + weather
pipeline as the positive sites.

Method
------
1. For each state, build the CONVEX HULL of that state's known landslide
   points (not a rectangular bounding box — a bbox risks spilling into
   Myanmar/Bhutan/Bangladesh at the NER border; a hull of real
   landslide-prone terrain stays much closer to plausible hilly land).
2. Rejection-sample random points inside that hull.
3. Reject any candidate within --exclusion-buffer-m of a known landslide
   point (so a negative can never accidentally sit on a true positive).
4. Reject any candidate within --min-spacing-m of an already-accepted
   negative (so negatives don't cluster into a handful of locations).
5. Allocate the target count per state proportional to that state's share
   of positive sites, so the negative set mirrors the existing geographic
   spread rather than over/under-representing any one state.

Output
------
data/raw/landslide/negative_sites_ner.csv
    Same shape as master_landslide_points_ner.csv (site_id, lat, lon,
    source, state, date, ls_type, trigger) so it can be fed straight into
    the same GEE export step your teammate already has working — just a
    new coordinate list, no new export code needed. ls_type/trigger are
    set to "none"; a landslide_occurred column (0) is added for clarity
    once this gets merged with the positive inventory for training.

Usage
-----
    python build_negative_sites.py
    python build_negative_sites.py --n-negatives 1900 --exclusion-buffer-m 1500
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from shapely.geometry import MultiPoint, Point
from scipy.spatial import cKDTree

REPO_ROOT = Path(__file__).resolve().parents[2]  # src/preprocessing -> repo root
RAW_LANDSLIDE_CSV = REPO_ROOT / "data" / "raw" / "landslide" / "master_landslide_points_ner.csv"
OUTPUT_CSV = REPO_ROOT / "data" / "raw" / "landslide" / "negative_sites_ner.csv"

EARTH_RADIUS_M = 6371000.0
MAX_ATTEMPTS_PER_STATE = 200000  # safety valve against infinite rejection loops


def latlon_to_xy(lat, lon, lat0_rad):
    """Cheap equirectangular projection to meters — fine for regional
    distance checks over an area the size of Northeast India."""
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
    required = ["site_id", "lat", "lon", "state"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"master CSV missing {missing}. Found: {list(df.columns)}")
    return df


def sample_negatives_for_state(state_name: str, state_points: pd.DataFrame,
                                 n_target: int, exclusion_buffer_m: float,
                                 min_spacing_m: float, rng: np.random.Generator) -> pd.DataFrame:
    if len(state_points) < 3:
        print(f"      [warn] {state_name}: only {len(state_points)} positive points — "
              f"can't build a convex hull, skipping this state")
        return pd.DataFrame(columns=["lat", "lon"])

    lat0_rad = np.radians(state_points["lat"].mean())
    hull = MultiPoint(list(zip(state_points["lon"], state_points["lat"]))).convex_hull
    if hull.geom_type != "Polygon":
        print(f"      [warn] {state_name}: points are collinear, no valid hull — skipping")
        return pd.DataFrame(columns=["lat", "lon"])

    minx, miny, maxx, maxy = hull.bounds  # lon_min, lat_min, lon_max, lat_max

    # KDTree of positive points, for the exclusion-buffer check
    px, py = latlon_to_xy(state_points["lat"].values, state_points["lon"].values, lat0_rad)
    positive_tree = cKDTree(np.column_stack([px, py]))

    accepted_lat, accepted_lon, accepted_x, accepted_y = [], [], [], []
    attempts = 0

    while len(accepted_lat) < n_target and attempts < MAX_ATTEMPTS_PER_STATE:
        attempts += 1
        cand_lon = rng.uniform(minx, maxx)
        cand_lat = rng.uniform(miny, maxy)
        if not hull.contains(Point(cand_lon, cand_lat)):
            continue

        cx, cy = latlon_to_xy(np.array([cand_lat]), np.array([cand_lon]), lat0_rad)
        cx, cy = cx[0], cy[0]

        # Reject if too close to any known landslide point
        dist_to_positive, _ = positive_tree.query([cx, cy], k=1)
        if dist_to_positive < exclusion_buffer_m:
            continue

        # Reject if too close to an already-accepted negative
        if accepted_x:
            neg_tree = cKDTree(np.column_stack([accepted_x, accepted_y]))
            dist_to_neg, _ = neg_tree.query([cx, cy], k=1)
            if dist_to_neg < min_spacing_m:
                continue

        accepted_lat.append(cand_lat)
        accepted_lon.append(cand_lon)
        accepted_x.append(cx)
        accepted_y.append(cy)

    if len(accepted_lat) < n_target:
        print(f"      [warn] {state_name}: only found {len(accepted_lat)}/{n_target} "
              f"valid negatives after {attempts:,} attempts — the hull may be too "
              f"small/dense for this many well-separated points. Consider lowering "
              f"--min-spacing-m or --n-negatives for this run.")

    return pd.DataFrame({"lat": accepted_lat, "lon": accepted_lon})


def build_negative_sites(n_negatives: int, exclusion_buffer_m: float,
                           min_spacing_m: float, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    print("[1/2] Loading master landslide points...")
    master_df = load_master_points()
    print(f"      {len(master_df):,} positive points across "
          f"{master_df['state'].nunique()} states")

    state_counts = master_df["state"].value_counts()
    total_positive = len(master_df)

    print(f"\n[2/2] Sampling {n_negatives:,} negative sites "
          f"(proportional to each state's share of positives)...")

    all_negatives = []
    running_total = 0
    states = list(state_counts.index)
    for i, state_name in enumerate(states):
        state_points = master_df[master_df["state"] == state_name]
        # Proportional allocation; give the last state whatever's left so
        # rounding doesn't leave the total short.
        if i == len(states) - 1:
            n_target = n_negatives - running_total
        else:
            n_target = round(n_negatives * len(state_points) / total_positive)
        running_total += n_target

        print(f"      {state_name}: {len(state_points)} positives -> "
              f"target {n_target} negatives")
        neg_df = sample_negatives_for_state(state_name, state_points, n_target,
                                              exclusion_buffer_m, min_spacing_m, rng)
        neg_df["state"] = state_name
        all_negatives.append(neg_df)

    result = pd.concat(all_negatives, ignore_index=True)
    result["site_id"] = [f"negative_{row.state.lower().replace(' ', '_')}_{i:05d}"
                          for i, row in enumerate(result.itertuples())]
    result["source"] = "negative_sample"
    result["date"] = ""
    result["ls_type"] = "none"
    result["trigger"] = "none"
    result["landslide_occurred"] = 0

    result = result[["site_id", "lat", "lon", "source", "state", "date",
                      "ls_type", "trigger", "landslide_occurred"]]
    return result


def main():
    parser = argparse.ArgumentParser(
        description="Sample negative (non-landslide) sites for the transformer's contrast class."
    )
    parser.add_argument("--n-negatives", type=int, default=1900,
                        help="Total negative sites to generate (default: 1900, "
                             "roughly a 1:5 ratio against ~9,600 positives)")
    parser.add_argument("--exclusion-buffer-m", type=float, default=1500.0,
                        help="Minimum distance (m) from any known landslide point (default: 1500)")
    parser.add_argument("--min-spacing-m", type=float, default=300.0,
                        help="Minimum distance (m) between generated negative sites (default: 300)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducibility")
    args = parser.parse_args()

    result = build_negative_sites(args.n_negatives, args.exclusion_buffer_m,
                                    args.min_spacing_m, args.seed)

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(OUTPUT_CSV, index=False)

    print(f"\n{'='*60}")
    print(f"  Generated {len(result):,} negative sites")
    print(f"  By state:\n{result['state'].value_counts().to_string()}")
    print(f"  Saved to: {OUTPUT_CSV}")
    print(f"{'='*60}")
    print(f"\nNext: hand negative_sites_ner.csv to whoever runs the GEE export "
          f"(same script, new coordinate list) to get satellite time-series "
          f"for these sites, same as the positive inventory.")


if __name__ == "__main__":
    main()