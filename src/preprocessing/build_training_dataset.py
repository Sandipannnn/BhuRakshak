"""
BhuRakshak — Final Training Dataset Builder
==============================================

Merges the positive (landslide-occurred) and negative (background) sites
into one labeled, training-ready table.

Assumes:
1. data/processed/aligned_dataset.csv — output of align_timeseries.py,
   already re-run to include BOTH positive satellite sites (site_id like
   'arunachal_pradesh_0050') and negative satellite sites (site_id like
   'negative_arunachal_pradesh_00042', from build_negative_sites.py) once
   the negative coordinates have been through the same GEE export +
   align_timeseries.py pipeline as the positives.
2. data/processed/label_crosswalk.csv — output of build_label_crosswalk.py,
   giving each POSITIVE satellite site its nearest master landslide
   record (ls_type, trigger, date, source, state).
3. data/raw/landslide/negative_sites_ner.csv — output of
   build_negative_sites.py, giving each NEGATIVE site's state (needed
   since negative sites were never run through the crosswalk — they were
   generated with a known label already, not matched to anything).

Negative sites are identified by the 'negative_' site_id prefix that
build_negative_sites.py assigns — this is a direct, unambiguous label
(landslide_occurred = 0 by construction), NOT a distance-based crosswalk
guess. Positive sites get their label via the crosswalk instead, since
that's the only way to connect a satellite site_id to the master
inventory's ls_type/trigger.

Output
------
data/processed/training_dataset.csv
    One row per (site_id, date), every satellite/weather feature column
    from aligned_dataset.csv, plus: landslide_occurred (1/0), ls_type,
    trigger, state, source.

Usage
-----
    python build_training_dataset.py
    python build_training_dataset.py --max-distance-m 250
"""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]  # src/preprocessing -> repo root
ALIGNED_CSV = REPO_ROOT / "data" / "processed" / "aligned_dataset.csv"
CROSSWALK_CSV = REPO_ROOT / "data" / "processed" / "label_crosswalk.csv"
NEGATIVE_SITES_CSV = REPO_ROOT / "data" / "raw" / "landslide" / "negative_sites_ner.csv"
OUTPUT_CSV = REPO_ROOT / "data" / "processed" / "training_dataset.csv"

NEGATIVE_PREFIX = "negative_"


def load_inputs():
    for path, label in [(ALIGNED_CSV, "aligned_dataset.csv"),
                         (CROSSWALK_CSV, "label_crosswalk.csv"),
                         (NEGATIVE_SITES_CSV, "negative_sites_ner.csv")]:
        if not path.exists():
            raise FileNotFoundError(
                f"Could not find {label} at {path}. "
                f"Run the earlier pipeline steps first (see this script's docstring)."
            )

    aligned_df = pd.read_csv(ALIGNED_CSV, parse_dates=["date"])
    crosswalk_df = pd.read_csv(CROSSWALK_CSV)
    negative_meta_df = pd.read_csv(NEGATIVE_SITES_CSV)
    negative_meta_df.columns = [c.strip().lower() for c in negative_meta_df.columns]
    return aligned_df, crosswalk_df, negative_meta_df


def build_training_dataset(max_distance_m: float, neg_exclusion_buffer_m: float) -> pd.DataFrame:
    print("[1/4] Loading aligned features, crosswalk, and negative-site metadata...")
    aligned_df, crosswalk_df, negative_meta_df = load_inputs()
    print(f"      aligned_dataset.csv: {len(aligned_df):,} rows, "
          f"{aligned_df['site_id'].nunique():,} sites")

    is_negative = aligned_df["site_id"].str.startswith(NEGATIVE_PREFIX)
    negative_rows = aligned_df[is_negative].copy()
    positive_rows = aligned_df[~is_negative].copy()
    print(f"      split: {positive_rows['site_id'].nunique():,} positive-candidate sites, "
          f"{negative_rows['site_id'].nunique():,} negative sites (by '{NEGATIVE_PREFIX}' prefix)")

    # --- Positive side: label via crosswalk ---------------------------------
    print("\n[2/4] Labeling positive sites via coordinate crosswalk...")
    crosswalk_matched = crosswalk_df[crosswalk_df["match_distance_m"] <= max_distance_m].copy()
    # 'date' in the crosswalk is the master inventory's recorded EVENT date —
    # renamed to event_date so it doesn't collide with aligned_df's own
    # 'date' column (the daily time-series date). Needed downstream for
    # event-window labeling (see build_event_windows.py).
    if "date" in crosswalk_matched.columns:
        crosswalk_matched = crosswalk_matched.rename(columns={"date": "event_date"})
    label_cols = [c for c in ("site_id", "ls_type", "trigger", "state", "source", "event_date")
                  if c in crosswalk_matched.columns]
    positive_labeled = positive_rows.merge(crosswalk_matched[label_cols], on="site_id", how="inner")
    positive_labeled["landslide_occurred"] = 1

    n_pos_before = positive_rows["site_id"].nunique()
    n_pos_after = positive_labeled["site_id"].nunique()
    dropped = n_pos_before - n_pos_after
    if dropped:
        print(f"      [warn] {dropped:,} positive-candidate sites had no crosswalk match "
              f"within {max_distance_m:.0f}m and were dropped (no reliable label available). "
              f"Check label_crosswalk.csv for matched==False rows if this number is large.")
    print(f"      {n_pos_after:,} positive sites labeled (landslide_occurred=1)")

    # --- Negative side: label is already known by construction --------------
    print("\n[3/4] Labeling negative sites (label known from generation, no crosswalk needed)...")
    # State is attached by NEAREST COORDINATE, not by site_id string match:
    # GEE renumbers negative sites with its own per-state counter (e.g.
    # negative_sites_ner.csv's 'negative_mizoram_00000' comes back from GEE
    # as 'mizoram_0000' — different zero-padding, so an ID-string join
    # silently fails for most sites even after re-adding the 'negative_'
    # prefix). Coordinates are the only reliable link between the two files.
    if "lat" in negative_rows.columns and "lon" in negative_rows.columns:
        from scipy.spatial import cKDTree
        neg_site_coords = negative_rows.groupby("site_id")[["lat", "lon"]].mean()

        EARTH_R = 6371000.0
        lat0 = np.radians(negative_meta_df["lat"].mean())
        def _to_xy(lat, lon):
            return EARTH_R * np.radians(lon) * np.cos(lat0), EARTH_R * np.radians(lat)

        gx, gy = _to_xy(negative_meta_df["lat"].values, negative_meta_df["lon"].values)
        sx, sy = _to_xy(neg_site_coords["lat"].values, neg_site_coords["lon"].values)
        tree = cKDTree(np.column_stack([gx, gy]))
        dist, idx = tree.query(np.column_stack([sx, sy]), k=1)

        state_by_site_id = pd.Series(
            negative_meta_df["state"].values[idx], index=neg_site_coords.index)
        negative_rows["state"] = negative_rows["site_id"].map(state_by_site_id)

        far = (dist > 100)  # should be ~0m; a mismatch here means real trouble
        if far.any():
            print(f"      [warn] {far.sum()} negative sites matched their generation "
                  f"metadata at >100m distance — check for a units or precision issue")
    else:
        negative_rows["state"] = np.nan
        print("      [warn] No lat/lon on negative rows — cannot attach state metadata")

    negative_rows["ls_type"] = "none"
    negative_rows["trigger"] = "none"
    negative_rows["source"] = "negative_sample"

    # Safety net: build_negative_sites.py's exclusion buffer only checks each
    # candidate against its OWN state's positive points, so a site sampled
    # near a state border (or affected by inconsistent state-name casing in
    # the master CSV) can end up close to a real landslide in a different
    # state/casing group without the generator ever knowing. The crosswalk
    # already computed each negative site's true nearest-master distance
    # regardless of state — use that as the actual source of truth here.
    neg_crosswalk = crosswalk_df[crosswalk_df["site_id"].isin(negative_rows["site_id"].unique())]
    too_close = set(neg_crosswalk.loc[neg_crosswalk["match_distance_m"] < neg_exclusion_buffer_m, "site_id"])
    if too_close:
        n_before = negative_rows["site_id"].nunique()
        negative_rows = negative_rows[~negative_rows["site_id"].isin(too_close)]
        print(f"      [warn] Dropped {len(too_close)} negative sites found within "
              f"{neg_exclusion_buffer_m:.0f}m of a real landslide (generation-time "
              f"exclusion check missed these — likely cross-border or state-name "
              f"casing gaps). {n_before - negative_rows['site_id'].nunique()} of "
              f"{n_before} negative sites remain.")
    negative_rows["landslide_occurred"] = 0
    negative_rows["event_date"] = pd.NaT

    n_neg_total = negative_rows["site_id"].nunique()
    print(f"      {n_neg_total:,} negative sites labeled (landslide_occurred=0)")

    # --- Combine --------------------------------------------------------------
    print("\n[4/4] Combining into final training table...")
    common_cols = [c for c in positive_labeled.columns if c in negative_rows.columns]
    final = pd.concat([positive_labeled[common_cols], negative_rows[common_cols]],
                       ignore_index=True)

    return final


def main():
    parser = argparse.ArgumentParser(
        description="Merge positive (crosswalk-labeled) and negative (pre-labeled) sites into one training table."
    )
    parser.add_argument("--max-distance-m", type=float, default=250.0,
                        help="Max crosswalk match distance to trust a positive site's label (default: 250m)")
    parser.add_argument("--neg-exclusion-buffer-m", type=float, default=1500.0,
                        help="Drop any negative site found within this distance of a real "
                             "landslide per the crosswalk — catches cross-border/state-casing "
                             "gaps in build_negative_sites.py's own exclusion check (default: 1500m)")
    args = parser.parse_args()

    final = build_training_dataset(args.max_distance_m, args.neg_exclusion_buffer_m)

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    final.to_csv(OUTPUT_CSV, index=False)

    n_pos_sites = final.loc[final["landslide_occurred"] == 1, "site_id"].nunique()
    n_neg_sites = final.loc[final["landslide_occurred"] == 0, "site_id"].nunique()
    n_pos_rows = (final["landslide_occurred"] == 1).sum()
    n_neg_rows = (final["landslide_occurred"] == 0).sum()

    print(f"\n{'='*60}")
    print(f"  Final training dataset: {len(final):,} rows, {final['site_id'].nunique():,} sites")
    print(f"  Sites  — positive: {n_pos_sites:,}   negative: {n_neg_sites:,}   "
          f"ratio 1:{n_pos_sites/max(n_neg_sites,1):.1f}")
    print(f"  Rows   — positive: {n_pos_rows:,}   negative: {n_neg_rows:,}")
    print(f"  Saved to: {OUTPUT_CSV}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()