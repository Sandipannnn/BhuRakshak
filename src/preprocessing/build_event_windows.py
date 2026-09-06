"""
BhuRakshak — Event-Window Labeling (memory-safe, batched)
============================================================

Converts training_dataset.csv (one row per site-day, statically labeled
landslide_occurred=1 for EVERY day of a positive site's ~7-year history)
into fixed-length windows labeled by proximity to the site's ACTUAL
recorded event date.

Why this exists: a static per-site label teaches the model "this
coordinate is landslide-prone" (a fixed fact), not "these conditions
right now indicate elevated risk" (the actual early-warning signal).

Labeling scheme
----------------
For each POSITIVE site (has a recorded event_date):
  - Exactly ONE positive window per site: the WINDOW_SIZE_DAYS days
    ending LEAD_TIME_DAYS before the event.
  - Negative windows from the SAME site: sampled every STRIDE_DAYS
    across the rest of that site's timeline, EXCLUDING a buffer zone
    around the event.
For each NEGATIVE site (no recorded event):
  - Negative windows sampled every STRIDE_DAYS across its whole timeline.

Negative windows are downsampled to --neg-to-pos-ratio times the
positive count.

WHY THIS VERSION IS DIFFERENT (memory)
----------------------------------------
The original version extracted the actual (30-day, N-feature) data slice
for EVERY candidate window — including all ~2 million candidate negative
windows generated before downsampling trims them to ~50K. Each extracted
slice is a small pandas DataFrame, but each one carries real object/index
overhead independent of its data size; multiplied by millions of
candidates, that overhead alone was enough to exhaust memory and crash.

This version splits the work into two passes:
  PASS 1 (cheap): for every site, compute which window END DATES qualify
    as positive/negative candidates using only each site's min/max date
    and event date — pure date arithmetic, no row data touched at all.
    Candidates are kept as lightweight (site_id, end_date, label) tuples.
  DOWNSAMPLE: trim negative candidates to the target ratio — operating on
    lightweight tuples, not data, so this is nearly free.
  PASS 2 (bounded): group the real data by site ONCE (same efficient
    groupby as before), but for each site only extract the SPECIFIC
    end dates selected in the downsample step, and write that site's
    rows to the output CSV immediately (append mode) rather than holding
    all sites' extracted windows in memory until the very end.

Output
------
data/processed/event_windows.csv
    Long-form: one row per (window_id, day_offset). Columns: window_id,
    site_id, day_offset, date, feature columns, label.

Usage
-----
    python build_event_windows.py
    python build_event_windows.py --window-size-days 30 --lead-time-days 14
    python build_event_windows.py --write-batch-sites 500
"""

import argparse
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

REPO_ROOT = Path(__file__).resolve().parents[2]  # src/preprocessing -> repo root
TRAINING_DATASET_CSV = REPO_ROOT / "data" / "processed" / "training_dataset.csv"
OUTPUT_CSV = REPO_ROOT / "data" / "processed" / "event_windows.csv"

NON_FEATURE_COLS = {"site_id", "date", "event_date", "landslide_occurred",
                     "ls_type", "trigger", "state", "source"}

# Columns known to repeat a small set of values across millions of rows —
# loading these as 'category' instead of plain strings cuts memory sharply
# (site_id alone repeats ~2,800 times per site across a 7-year daily grid).
CATEGORY_COLS = ["site_id", "ls_type", "trigger", "state", "source"]
# Feature columns stored as float64 by default; float32 halves their
# memory with no meaningful precision loss for this data.
FLOAT32_CANDIDATE_SUFFIXES = ("ndvi", "ndmi", "sar_vv", "sar_vh", "lat", "lon",
                                "days_since_obs", "precipitation", "temperature",
                                "soil_moisture")


def load_training_dataset_memory_efficient() -> pd.DataFrame:
    """Load training_dataset.csv with dtypes chosen to minimize memory:
    repeated strings as 'category', numeric features as float32."""
    header = pd.read_csv(TRAINING_DATASET_CSV, nrows=0)
    dtype_map = {}
    for col in header.columns:
        if col in CATEGORY_COLS:
            dtype_map[col] = "category"
        elif any(col.lower().startswith(s) or s in col.lower() for s in FLOAT32_CANDIDATE_SUFFIXES):
            dtype_map[col] = "float32"
    if "landslide_occurred" in header.columns:
        dtype_map["landslide_occurred"] = "int8"

    df = pd.read_csv(TRAINING_DATASET_CSV, parse_dates=["date", "event_date"],
                      dtype=dtype_map)
    return df


# ---------------------------------------------------------------------------
# PASS 1 — lightweight candidate window keys (no row data touched)
# ---------------------------------------------------------------------------

def find_candidate_keys_for_positive_site(site_id: str, min_date: pd.Timestamp,
                                            max_date: pd.Timestamp, event_date: pd.Timestamp,
                                            window_size_days: int, lead_time_days: int,
                                            stride_days: int, exclusion_buffer_days: int) -> list:
    """Return [(site_id, end_date, label), ...] using only date bounds —
    no access to the site's actual feature rows."""
    keys = []

    pos_end = event_date - pd.Timedelta(days=lead_time_days)
    pos_start = pos_end - pd.Timedelta(days=window_size_days - 1)
    if pos_start < min_date or pos_end > max_date:
        return keys  # not enough history for this site's positive window
    keys.append((site_id, pos_end, 1))

    exclusion_start = pos_start - pd.Timedelta(days=exclusion_buffer_days)
    exclusion_end = event_date + pd.Timedelta(days=exclusion_buffer_days)

    first_end = min_date + pd.Timedelta(days=window_size_days - 1)
    if first_end > max_date:
        return keys
    for end_date in pd.date_range(first_end, max_date, freq=f"{stride_days}D"):
        if exclusion_start <= end_date <= exclusion_end:
            continue
        keys.append((site_id, end_date, 0))

    return keys


def find_candidate_keys_for_negative_site(site_id: str, min_date: pd.Timestamp,
                                            max_date: pd.Timestamp, window_size_days: int,
                                            stride_days: int) -> list:
    keys = []
    first_end = min_date + pd.Timedelta(days=window_size_days - 1)
    if first_end > max_date:
        return keys
    for end_date in pd.date_range(first_end, max_date, freq=f"{stride_days}D"):
        keys.append((site_id, end_date, 0))
    return keys


def build_candidate_keys(df: pd.DataFrame, window_size_days: int, lead_time_days: int,
                           stride_days: int, exclusion_buffer_days: int) -> pd.DataFrame:
    """One cheap groupby-aggregate over the full table (no per-site row
    slicing) to get each site's date bounds, then pure date arithmetic
    to enumerate candidate window keys."""
    site_summary = df.groupby("site_id", observed=True).agg(
        min_date=("date", "min"),
        max_date=("date", "max"),
        event_date=("event_date", "first"),
    ).reset_index()

    all_keys = []
    n_sites = len(site_summary)
    for i, row in enumerate(site_summary.itertuples(index=False), start=1):
        if i % 2000 == 0 or i == n_sites:
            print(f"      ... {i}/{n_sites} sites scanned for candidate windows")
        if pd.notna(row.event_date):
            keys = find_candidate_keys_for_positive_site(
                row.site_id, row.min_date, row.max_date, row.event_date,
                window_size_days, lead_time_days, stride_days, exclusion_buffer_days)
        else:
            keys = find_candidate_keys_for_negative_site(
                row.site_id, row.min_date, row.max_date, window_size_days, stride_days)
        all_keys.extend(keys)

    return pd.DataFrame(all_keys, columns=["site_id", "end_date", "label"])


# ---------------------------------------------------------------------------
# PASS 2 — materialize ONLY the selected windows, writing incrementally
# ---------------------------------------------------------------------------

def materialize_and_write(df: pd.DataFrame, selected_keys: pd.DataFrame,
                            window_size_days: int, write_batch_sites: int) -> tuple:
    """Group the real data once, extract only the selected windows per
    site, and append to OUTPUT_CSV in batches — never holding more than
    write_batch_sites' worth of extracted rows in memory at once."""
    keys_by_site = {}
    for sid, g in selected_keys.groupby("site_id", observed=True):
        keys_by_site[sid] = list(zip(g["end_date"], g["label"]))

    grouped = df.groupby("site_id", observed=True, sort=False)
    n_sites_with_selections = len(keys_by_site)

    first_write = True
    window_counter = 0
    n_pos_written, n_neg_written = 0, 0
    batch_frames = []
    sites_in_batch = 0
    sites_processed = 0
    feature_cols = None

    for site_id, site_df in grouped:
        if site_id not in keys_by_site:
            continue
        sites_processed += 1
        if sites_processed % 1000 == 0 or sites_processed == n_sites_with_selections:
            print(f"      ... {sites_processed}/{n_sites_with_selections} "
                  f"sites with selected windows materialized")

        site_df = site_df.sort_values("date")
        if feature_cols is None:
            feature_cols = [c for c in site_df.columns if c not in NON_FEATURE_COLS]

        for end_date, label in keys_by_site[site_id]:
            start_date = end_date - pd.Timedelta(days=window_size_days - 1)
            window = site_df[(site_df["date"] >= start_date) & (site_df["date"] <= end_date)]
            if len(window) < window_size_days:
                continue  # shouldn't happen given Pass 1's bounds check, but stay safe

            w = window[["date"] + feature_cols].copy()
            w["window_id"] = f"{site_id}__w{window_counter:06d}"
            w["site_id"] = site_id
            w["day_offset"] = range(len(w))
            w["label"] = label
            batch_frames.append(w)
            window_counter += 1
            if label == 1:
                n_pos_written += 1
            else:
                n_neg_written += 1

        sites_in_batch += 1
        if sites_in_batch >= write_batch_sites:
            _flush_batch(batch_frames, feature_cols, first_write)
            first_write = False
            batch_frames = []
            sites_in_batch = 0

    if batch_frames:
        _flush_batch(batch_frames, feature_cols, first_write)

    return n_pos_written, n_neg_written


def _flush_batch(batch_frames: list, feature_cols: list, first_write: bool):
    if not batch_frames:
        return
    combined = pd.concat(batch_frames, ignore_index=True)
    cols = ["window_id", "site_id", "day_offset", "date", "label"] + feature_cols
    combined = combined[cols]
    combined.to_csv(OUTPUT_CSV, mode="w" if first_write else "a",
                     header=first_write, index=False)


def main():
    parser = argparse.ArgumentParser(
        description="Convert per-day training table into event-proximity-labeled fixed-length "
                    "windows, using a memory-bounded two-pass approach."
    )
    parser.add_argument("--window-size-days", type=int, default=30)
    parser.add_argument("--lead-time-days", type=int, default=14)
    parser.add_argument("--stride-days", type=int, default=15)
    parser.add_argument("--exclusion-buffer-days", type=int, default=30)
    parser.add_argument("--neg-to-pos-ratio", type=float, default=5.0)
    parser.add_argument("--write-batch-sites", type=int, default=500,
                        help="How many sites' windows to accumulate before writing to disk "
                             "(default: 500). Lower this if memory is still tight.")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    print("[1/4] Loading training_dataset.csv (memory-optimized dtypes)...")
    df = load_training_dataset_memory_efficient()
    print(f"      {len(df):,} rows, {df['site_id'].nunique():,} sites, "
          f"~{df.memory_usage(deep=True).sum() / 1e9:.2f} GB in memory")

    print("\n[2/4] Scanning for candidate window keys (date arithmetic only, no row data)...")
    candidates = build_candidate_keys(df, args.window_size_days, args.lead_time_days,
                                        args.stride_days, args.exclusion_buffer_days)
    n_pos_candidates = (candidates["label"] == 1).sum()
    n_neg_candidates = (candidates["label"] == 0).sum()
    print(f"      {n_pos_candidates:,} positive candidates, "
          f"{n_neg_candidates:,} negative candidates")

    if n_pos_candidates == 0:
        dated_events = df.loc[df["event_date"].notna(), "event_date"]
        data_start = df["date"].min()
        data_end = df["date"].max()
        event_start = dated_events.min() if not dated_events.empty else "none"
        event_end = dated_events.max() if not dated_events.empty else "none"
        raise RuntimeError(
            "No positive event windows can be generated. "
            f"Feature dates: {data_start.date()} to {data_end.date()}; "
            f"dated events: {event_start} to {event_end}. "
            "Provide satellite history covering the event dates (including "
            f"at least {args.window_size_days + args.lead_time_days} days before "
            "each event), then rerun alignment and this script. "
            "Do not train an early-warning transformer from the empty output."
        )

    print("\n[3/4] Downsampling negative candidates...")
    rng = np.random.default_rng(args.seed)
    target_neg = int(round(n_pos_candidates * args.neg_to_pos_ratio))
    pos_keys = candidates[candidates["label"] == 1]
    neg_keys = candidates[candidates["label"] == 0]
    if len(neg_keys) > target_neg:
        neg_keys = neg_keys.sample(n=target_neg, random_state=args.seed)
        print(f"      Downsampled to {target_neg:,} negative windows (ratio {args.neg_to_pos_ratio}:1)")
    else:
        print(f"      [warn] Only {len(neg_keys):,} negative candidates available, "
              f"fewer than the {target_neg:,} target — using all of them.")
    selected_keys = pd.concat([pos_keys, neg_keys], ignore_index=True)
    del candidates, pos_keys, neg_keys  # free the full candidate set before Pass 2

    print(f"\n[4/4] Materializing {len(selected_keys):,} selected windows "
          f"(writing in batches of {args.write_batch_sites} sites)...")
    if OUTPUT_CSV.exists():
        OUTPUT_CSV.unlink()  # start clean since we're appending in batches
    n_pos, n_neg = materialize_and_write(df, selected_keys, args.window_size_days,
                                           args.write_batch_sites)

    print(f"\n{'='*60}")
    print(f"  {n_pos + n_neg:,} windows written ({args.window_size_days} days each)")
    print(f"  Positive windows: {n_pos:,}")
    print(f"  Negative windows: {n_neg:,}")
    print(f"  Saved to: {OUTPUT_CSV}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()