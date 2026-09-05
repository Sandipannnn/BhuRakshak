"""
BhuRakshak — Event-Window Labeling
====================================

Converts training_dataset.csv (one row per site-day, statically labeled
landslide_occurred=1 for EVERY day of a positive site's ~7-year history)
into fixed-length windows labeled by proximity to the site's ACTUAL
recorded event date.

Why this exists: a static per-site label teaches the model "this
coordinate is landslide-prone" (a fixed fact), not "these conditions
right now indicate elevated risk" (the actual early-warning signal). A
model trained that way would flag a known landslide site as high-risk
forever, including the day after the slide already happened and
regardless of season — which fails the actual early-warning use case.

Labeling scheme
----------------
For each POSITIVE site (has a recorded event_date):
  - Exactly ONE positive window per site: the WINDOW_SIZE_DAYS days
    ending LEAD_TIME_DAYS before the event. This is the window a real
    early-warning system would have seen and needed to act on.
  - Negative windows from the SAME site: sampled every STRIDE_DAYS
    across the rest of that site's timeline, EXCLUDING an exclusion
    zone around the event (the positive window itself, plus some
    buffer after the event) — so "already showing precursors, just not
    called positive" or "still unsettled right after the slide" days
    don't get mislabeled as clean negatives.

For each NEGATIVE site (no recorded event):
  - Negative windows sampled every STRIDE_DAYS across its whole
    timeline.

Negative windows are pooled and randomly downsampled to
--neg-to-pos-ratio times the positive count, so the final dataset has a
controlled, known class balance rather than whatever volume the striding
happens to produce.

Output
------
data/processed/event_windows.csv
    Long-form: one row per (window_id, day_offset) — group by window_id
    and sort by day_offset to reconstruct each (WINDOW_SIZE_DAYS, n_features)
    sequence. Columns: window_id, site_id, day_offset, date, all feature
    columns from training_dataset.csv, label (constant per window_id).

Usage
-----
    python build_event_windows.py
    python build_event_windows.py --window-size-days 30 --lead-time-days 14
"""

import argparse
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]  # src/preprocessing -> repo root
TRAINING_DATASET_CSV = REPO_ROOT / "data" / "processed" / "training_dataset.csv"
OUTPUT_CSV = REPO_ROOT / "data" / "processed" / "event_windows.csv"

# Columns that describe the window/site, not per-day features — excluded
# from the feature set but kept as metadata.
NON_FEATURE_COLS = {"site_id", "date", "event_date", "landslide_occurred",
                     "ls_type", "trigger", "state", "source"}


def extract_window(site_df: pd.DataFrame, end_date: pd.Timestamp,
                    window_size_days: int) -> Optional[pd.DataFrame]:
    """Return the window_size_days rows ending at end_date (inclusive), or
    None if the site doesn't have that much history before end_date."""
    start_date = end_date - pd.Timedelta(days=window_size_days - 1)
    window = site_df[(site_df["date"] >= start_date) & (site_df["date"] <= end_date)]
    if len(window) < window_size_days:
        return None  # not enough history — e.g. event too close to 2019-01-01
    return window.sort_values("date")


def build_windows_for_positive_site(site_df: pd.DataFrame, event_date: pd.Timestamp,
                                      window_size_days: int, lead_time_days: int,
                                      stride_days: int, exclusion_buffer_days: int,
                                      rng: np.random.Generator) -> list:
    windows = []

    # --- The one positive window: ends lead_time_days before the event ---
    pos_end = event_date - pd.Timedelta(days=lead_time_days)
    pos_window = extract_window(site_df, pos_end, window_size_days)
    if pos_window is None:
        return windows  # not enough history for this site's positive window
    windows.append((pos_window, 1))

    # --- Negative windows from the same site, away from the event ---
    pos_start = pos_end - pd.Timedelta(days=window_size_days - 1)
    exclusion_start = pos_start - pd.Timedelta(days=exclusion_buffer_days)
    exclusion_end = event_date + pd.Timedelta(days=exclusion_buffer_days)

    all_dates = site_df["date"].sort_values().unique()
    candidate_ends = pd.to_datetime(all_dates[window_size_days - 1::stride_days])
    for end_date in candidate_ends:
        if exclusion_start <= end_date <= exclusion_end:
            continue  # too close to the event — ambiguous, skip
        neg_window = extract_window(site_df, end_date, window_size_days)
        if neg_window is not None:
            windows.append((neg_window, 0))

    return windows


def build_windows_for_negative_site(site_df: pd.DataFrame, window_size_days: int,
                                      stride_days: int) -> list:
    windows = []
    all_dates = site_df["date"].sort_values().unique()
    candidate_ends = pd.to_datetime(all_dates[window_size_days - 1::stride_days])
    for end_date in candidate_ends:
        window = extract_window(site_df, end_date, window_size_days)
        if window is not None:
            windows.append((window, 0))
    return windows


def build_event_windows(window_size_days: int, lead_time_days: int, stride_days: int,
                          exclusion_buffer_days: int, neg_to_pos_ratio: float,
                          seed: int) -> pd.DataFrame:
    print("[1/3] Loading training_dataset.csv...")
    df = pd.read_csv(TRAINING_DATASET_CSV, parse_dates=["date", "event_date"])
    print(f"      {len(df):,} rows, {df['site_id'].nunique():,} sites")

    rng = np.random.default_rng(seed)
    positive_windows, negative_windows = [], []

    print("\n[2/3] Extracting windows per site...")
    site_ids = df["site_id"].unique()
    for i, site_id in enumerate(site_ids, start=1):
        if i % 1000 == 0 or i == len(site_ids):
            print(f"      ... {i}/{len(site_ids)} sites processed")

        site_df = df[df["site_id"] == site_id]
        event_date = site_df["event_date"].iloc[0]

        if pd.notna(event_date):
            windows = build_windows_for_positive_site(
                site_df, event_date, window_size_days, lead_time_days,
                stride_days, exclusion_buffer_days, rng)
        else:
            windows = build_windows_for_negative_site(site_df, window_size_days, stride_days)

        for window_df, label in windows:
            (positive_windows if label == 1 else negative_windows).append((site_id, window_df))

    n_pos = len(positive_windows)
    n_neg_available = len(negative_windows)
    print(f"\n      {n_pos:,} positive windows extracted (one per positive site with enough history)")
    print(f"      {n_neg_available:,} negative windows available before downsampling")

    target_neg = int(round(n_pos * neg_to_pos_ratio))
    if n_neg_available > target_neg:
        keep_idx = rng.choice(n_neg_available, size=target_neg, replace=False)
        negative_windows = [negative_windows[i] for i in keep_idx]
        print(f"      Downsampled negatives to {target_neg:,} (ratio {neg_to_pos_ratio:.1f}:1)")
    else:
        print(f"      [warn] Only {n_neg_available:,} negative windows available, "
              f"fewer than the {target_neg:,} target for a {neg_to_pos_ratio:.1f}:1 ratio — "
              f"using all of them. Consider a smaller --stride-days for more negative coverage.")

    print("\n[3/3] Assembling long-form output table...")
    rows = []
    all_windows = [(sid, w, 1) for sid, w in positive_windows] + \
                  [(sid, w, 0) for sid, w in negative_windows]

    for window_num, (site_id, window_df, label) in enumerate(all_windows):
        window_id = f"{site_id}__w{window_num:06d}"
        feature_cols = [c for c in window_df.columns if c not in NON_FEATURE_COLS]
        for day_offset, (_, row) in enumerate(window_df.iterrows()):
            record = {"window_id": window_id, "site_id": site_id,
                      "day_offset": day_offset, "date": row["date"], "label": label}
            for col in feature_cols:
                record[col] = row[col]
            rows.append(record)

    result = pd.DataFrame(rows)
    return result


def main():
    parser = argparse.ArgumentParser(
        description="Convert per-day training table into event-proximity-labeled fixed-length windows."
    )
    parser.add_argument("--window-size-days", type=int, default=30,
                        help="Length of each input sequence (default: 30)")
    parser.add_argument("--lead-time-days", type=int, default=14,
                        help="How many days before the event the positive window ends — "
                             "i.e. how much warning time the model is trained to give (default: 14)")
    parser.add_argument("--stride-days", type=int, default=15,
                        help="Spacing between sampled negative window end-dates (default: 15)")
    parser.add_argument("--exclusion-buffer-days", type=int, default=30,
                        help="Days of buffer around the event to exclude from negative sampling "
                             "on positive sites, on top of the positive window itself (default: 30)")
    parser.add_argument("--neg-to-pos-ratio", type=float, default=5.0,
                        help="Target ratio of negative to positive windows after downsampling (default: 5.0)")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    result = build_event_windows(args.window_size_days, args.lead_time_days,
                                   args.stride_days, args.exclusion_buffer_days,
                                   args.neg_to_pos_ratio, args.seed)

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(OUTPUT_CSV, index=False)

    n_windows = result["window_id"].nunique()
    label_by_window = result.drop_duplicates("window_id")["label"]
    print(f"\n{'='*60}")
    print(f"  {n_windows:,} windows, {len(result):,} rows "
          f"({args.window_size_days} days each)")
    print(f"  Positive windows: {(label_by_window == 1).sum():,}")
    print(f"  Negative windows: {(label_by_window == 0).sum():,}")
    print(f"  Saved to: {OUTPUT_CSV}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()