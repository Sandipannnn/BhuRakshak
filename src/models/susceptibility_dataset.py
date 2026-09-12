"""Utilities for loading site-level windows for susceptibility training."""

from pathlib import Path

import numpy as np
import pandas as pd


DEFAULT_FEATURES = [
    "ndvi", "ndmi", "sar_vv", "sar_vh",
    "ndvi_days_since_obs", "ndmi_days_since_obs",
    "sar_vv_days_since_obs", "sar_vh_days_since_obs",
    "lat", "lon",
]


def load_site_windows(
    csv_path: str | Path,
    window_size: int = 30,
    features: list[str] | None = None,
    chunksize: int = 250_000,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Load one trailing fixed-length window per site.

    The label is site-level susceptibility, so rows are grouped by site and
    split later by site_id. No event dates are required for this task.
    """
    path = Path(csv_path)
    header = pd.read_csv(path, nrows=0)
    selected = features or DEFAULT_FEATURES
    required = {"site_id", "date", "landslide_occurred", *selected}
    missing = required.difference(header.columns)
    if missing:
        raise ValueError(f"Missing columns in {path}: {sorted(missing)}")

    windows: list[np.ndarray] = []
    labels: list[int] = []
    carry = pd.DataFrame(columns=sorted(required))

    # The preprocessing output is site/date sorted. Keep the final site from
    # each chunk because it may continue in the next chunk; all earlier sites
    # are complete and can be reduced to one trailing window immediately.
    for chunk in pd.read_csv(
        path,
        usecols=sorted(required),
        parse_dates=["date"],
        chunksize=chunksize,
        low_memory=False,
    ):
        if not carry.empty:
            chunk = pd.concat([carry, chunk], ignore_index=True)
        last_site = chunk["site_id"].iloc[-1]
        complete = chunk[chunk["site_id"] != last_site]
        carry = chunk[chunk["site_id"] == last_site].copy()
        for _, group in complete.groupby("site_id", sort=False):
            if len(group) < window_size:
                continue
            values = group[selected].to_numpy(dtype=np.float32)
            values = np.nan_to_num(values, nan=0.0, posinf=0.0, neginf=0.0)
            windows.append(values[-window_size:])
            labels.append(int(group["landslide_occurred"].iloc[0]))

    if not carry.empty and len(carry) >= window_size:
        values = carry[selected].to_numpy(dtype=np.float32)
        values = np.nan_to_num(values, nan=0.0, posinf=0.0, neginf=0.0)
        windows.append(values[-window_size:])
        labels.append(int(carry["landslide_occurred"].iloc[0]))

    if not windows:
        raise ValueError("No sites contain a complete susceptibility window.")
    return np.stack(windows), np.asarray(labels, dtype=np.float32), selected


def load_latest_site_windows(
    csv_path: str | Path,
    site_ids: list[str],
    window_size: int = 30,
    features: list[str] | None = None,
    chunksize: int = 250_000,
) -> dict[str, np.ndarray]:
    """Load the latest trailing window for each requested site using one
    pass over the processed training CSV, sharing the expensive scan across
    the whole requested site list instead of re-scanning once per site.

    This keeps the file-scanner in a single pass but groups the matching
    rows by `site_id` within each chunk so the requested IDs are not
    repeatedly filtered with the same dataframe slice in a nested loop.
    """
    path = Path(csv_path)
    selected = features or DEFAULT_FEATURES
    required = {"site_id", "date", *selected}
    header = pd.read_csv(path, nrows=0)
    missing = required.difference(header.columns)
    if missing:
        raise ValueError(f"Missing columns in {path}: {sorted(missing)}")

    wanted = set(site_ids)
    frames = {site_id: [] for site_id in wanted}

    for chunk in pd.read_csv(
        path,
        usecols=sorted(required),
        parse_dates=["date"],
        chunksize=chunksize,
        low_memory=False,
    ):
        match = chunk[chunk["site_id"].isin(wanted)]
        if match.empty:
            continue

        for site_id, site_chunk in match.groupby("site_id", sort=False):
            if site_id in frames:
                frames[site_id].append(site_chunk)

    windows: dict[str, np.ndarray] = {}
    for site_id in site_ids:
        pieces = frames.get(site_id, [])
        if not pieces:
            continue
        site_df = pd.concat(pieces, ignore_index=True).sort_values("date")
        if len(site_df) < window_size:
            continue
        values = site_df[selected].tail(window_size).to_numpy(dtype=np.float32)
        windows[site_id] = np.nan_to_num(values, nan=0.0, posinf=0.0, neginf=0.0)

    return windows


def load_latest_site_window(
    csv_path: str | Path,
    site_id: str,
    window_size: int = 30,
    features: list[str] | None = None,
    chunksize: int = 250_000,
) -> np.ndarray:
    """Load the latest fixed-length window for one site without full-file loading."""
    path = Path(csv_path)
    selected = features or DEFAULT_FEATURES
    required = {"site_id", "date", *selected}
    header = pd.read_csv(path, nrows=0)
    missing = required.difference(header.columns)
    if missing:
        raise ValueError(f"Missing columns in {path}: {sorted(missing)}")

    site_rows = []
    for chunk in pd.read_csv(
        path,
        usecols=sorted(required),
        parse_dates=["date"],
        chunksize=chunksize,
        low_memory=False,
    ):
        matching = chunk[chunk["site_id"] == site_id]
        if not matching.empty:
            site_rows.append(matching)

    if not site_rows:
        raise ValueError(f"Site ID not found: {site_id}")
    site_df = pd.concat(site_rows, ignore_index=True).sort_values("date")
    if len(site_df) < window_size:
        raise ValueError(
            f"Site {site_id} has {len(site_df)} rows; "
            f"at least {window_size} are required."
        )
    values = site_df[selected].tail(window_size).to_numpy(dtype=np.float32)
    return np.nan_to_num(values, nan=0.0, posinf=0.0, neginf=0.0)