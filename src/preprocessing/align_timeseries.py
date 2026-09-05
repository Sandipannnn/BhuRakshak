"""
BhuRakshak — Data Preprocessing & Alignment
=============================================

Merges the per-site satellite time-series CSVs exported from Google Earth
Engine with historical weather data pulled from the Open-Meteo Archive API,
then forward/backward-fills gaps so every site has a uniform daily sequence
ready for the Temporal Transformer.

Expected inputs
----------------
1. data/raw/landslide/master_landslide_points_ner.csv
   Must contain: site_id, lat, lon

2. data/raw/satellite/bhurakshak_s1_batch*.csv
   Sentinel-1 SAR exports. Columns: site, date, sar_vv, sar_vh

3. data/raw/satellite/bhurakshak_s2_batch*.csv
   Sentinel-2 Optical exports. Columns: site, date, ndvi, ndmi, cloud_pct

Output
------
data/processed/aligned_dataset.csv
    One row per (site_id, date) with satellite indicators + weather
    features, gap-filled to a uniform daily grid per site. Each satellite
    indicator also gets a companion `<col>_days_since_obs` column giving
    the number of days to the nearest REAL observation (0 = real reading,
    N>0 = filled, N days from the closest actual satellite pass). This lets
    the transformer learn to trust fresh readings over stale filled ones —
    important during monsoon, when cloud cover (and therefore fill gaps)
    is worst right when landslide risk is highest.

Usage
-----
    # Full run (satellite + weather + gap-fill):
    python src/preprocessing/align_timeseries.py

    # Skip weather API calls (useful for quick iteration):
    python src/preprocessing/align_timeseries.py --skip-weather

    # Dry run with synthetic data to validate the pipeline:
    python src/preprocessing/align_timeseries.py --test-mode
"""

import argparse
import glob
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]  # src/preprocessing -> repo root
RAW_LANDSLIDE_CSV = REPO_ROOT / "data" / "raw" / "landslide" / "master_landslide_points_ner.csv"
RAW_SATELLITE_DIR = REPO_ROOT / "data" / "raw" / "satellite"
PROCESSED_DIR     = REPO_ROOT / "data" / "processed"
WEATHER_CACHE_DIR = REPO_ROOT / "data" / "raw" / "weather_cache"

OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_DAILY_VARS = [
    "precipitation_sum",
    "temperature_2m_max",
    "temperature_2m_min",
    "soil_moisture_0_to_7cm_mean",
]

# Cloud percentage threshold — S2 observations above this are discarded
# before gap-filling, since NDVI/NDMI are unreliable under heavy cloud.
CLOUD_PCT_THRESHOLD = 30.0

REQUEST_TIMEOUT_S = 20
REQUEST_PAUSE_S   = 6.0  # polite rate-limit for the free Open-Meteo tier

# Satellite indicator columns that get a companion "days_since_obs" column
SATELLITE_INDICATOR_COLS = ["ndvi", "ndmi", "sar_vv", "sar_vh"]


# ---------------------------------------------------------------------------
# Step 1 — Load site metadata
# ---------------------------------------------------------------------------

def load_site_metadata() -> pd.DataFrame:
    """Load master_landslide_points_ner.csv and return (site_id, lat, lon)."""
    if not RAW_LANDSLIDE_CSV.exists():
        raise FileNotFoundError(
            f"Could not find {RAW_LANDSLIDE_CSV}. "
            "Run merge_landslide_datasets.py first, or pass --test-mode."
        )
    df = pd.read_csv(RAW_LANDSLIDE_CSV)
    print(f"      Master CSV columns: {list(df.columns)}")

    # Standardise column names
    rename_map = {}
    if "site_id" in df.columns:
        rename_map["site_id"] = "site_id"
    elif "site" in df.columns:
        rename_map["site"] = "site_id"

    if "lat" in df.columns:
        rename_map["lat"] = "latitude"
    elif "latitude" in df.columns:
        rename_map["latitude"] = "latitude"

    if "lon" in df.columns:
        rename_map["lon"] = "longitude"
    elif "longitude" in df.columns:
        rename_map["longitude"] = "longitude"

    df = df.rename(columns=rename_map)

    required = ["site_id", "latitude", "longitude"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(
            f"master_landslide_points_ner.csv is missing columns {missing}. "
            f"Available: {list(df.columns)}"
        )

    df = df[required].drop_duplicates(subset="site_id").reset_index(drop=True)
    return df


# ---------------------------------------------------------------------------
# Step 2 — Load & merge GEE satellite CSV batches
# ---------------------------------------------------------------------------

def _pick_best_batches(csv_paths: list[str]) -> list[str]:
    """
    When Google Drive has both `batchXXX.csv` and `batchXXX(1).csv`, keep
    only the LARGER file (the one from the full master-dataset run).
    Also skip the old `satellite_timeseries_raw.csv` leftover.
    """
    from collections import defaultdict
    import re

    # Group by canonical batch name  e.g. "bhurakshak_s1_batch003"
    groups: dict[str, list[str]] = defaultdict(list)
    skipped = []
    for p in csv_paths:
        basename = os.path.basename(p)
        # Skip the old single-file leftover from the COOLR-only run
        if basename == "satellite_timeseries_raw.csv":
            skipped.append(basename)
            continue
        # Strip the "(1)" suffix to find the canonical name
        canonical = re.sub(r"\(\d+\)", "", basename).replace(".csv", "").strip()
        groups[canonical].append(p)

    if skipped:
        print(f"      [skip] Ignoring legacy file(s): {skipped}")

    best = []
    duplicates_resolved = 0
    for canonical, paths in groups.items():
        if len(paths) == 1:
            best.append(paths[0])
        else:
            # Keep the largest file (most complete export)
            paths.sort(key=lambda p: os.path.getsize(p), reverse=True)
            best.append(paths[0])
            duplicates_resolved += 1

    if duplicates_resolved:
        print(f"      [dedup] Resolved {duplicates_resolved} duplicate batch pairs "
              f"(kept larger file in each case)")
    return sorted(best)


def load_s1_batches() -> pd.DataFrame:
    """Load all Sentinel-1 batch CSVs and return a unified DataFrame."""
    pattern = str(RAW_SATELLITE_DIR / "bhurakshak_s1_batch*.csv")
    csv_paths = _pick_best_batches(sorted(glob.glob(pattern)))
    if not csv_paths:
        print("      [warn] No S1 CSVs found.")
        return pd.DataFrame(columns=["site_id", "date", "sar_vv", "sar_vh"])

    frames = []
    for path in csv_paths:
        df = pd.read_csv(path, usecols=lambda c: c.lower().strip() in
                         ("site", "date", "sar_vv", "sar_vh", "lat", "lon"))
        df.columns = [c.strip().lower() for c in df.columns]
        if "site" in df.columns:
            df = df.rename(columns={"site": "site_id"})
        df["site_id"] = df["site_id"].str.lower()  # normalise casing across batches
        frames.append(df)

    merged = pd.concat(frames, ignore_index=True)
    merged["date"] = pd.to_datetime(merged["date"], errors="coerce")
    merged = merged.dropna(subset=["date"])
    # Average overlapping site+date rows (from duplicate batches).
    # lat/lon ride along as numeric columns and get averaged too — harmless
    # since a given site's coordinates should be constant across rows.
    merged = merged.groupby(["site_id", "date"], as_index=False).mean(numeric_only=True)
    print(f"      S1: {len(csv_paths)} files -> {len(merged):,} rows")
    return merged


def load_s2_batches() -> pd.DataFrame:
    """Load all Sentinel-2 batch CSVs, apply cloud filter, return DataFrame."""
    pattern = str(RAW_SATELLITE_DIR / "bhurakshak_s2_batch*.csv")
    csv_paths = _pick_best_batches(sorted(glob.glob(pattern)))
    if not csv_paths:
        print("      [warn] No S2 CSVs found.")
        return pd.DataFrame(columns=["site_id", "date", "ndvi", "ndmi"])

    frames = []
    for path in csv_paths:
        df = pd.read_csv(path, usecols=lambda c: c.lower().strip() in
                         ("site", "date", "ndvi", "ndmi", "cloud_pct", "lat", "lon"))
        df.columns = [c.strip().lower() for c in df.columns]
        if "site" in df.columns:
            df = df.rename(columns={"site": "site_id"})
        df["site_id"] = df["site_id"].str.lower()  # normalise casing across batches
        frames.append(df)

    merged = pd.concat(frames, ignore_index=True)
    merged["date"] = pd.to_datetime(merged["date"], errors="coerce")
    merged = merged.dropna(subset=["date"])

    # Cloud-mask: drop rows with excessive cloud cover
    total_before = len(merged)
    if "cloud_pct" in merged.columns:
        merged = merged[merged["cloud_pct"] <= CLOUD_PCT_THRESHOLD].copy()
        merged = merged.drop(columns=["cloud_pct"])
    # Also drop rows where NDVI/NDMI are NaN (cloud-masked by GEE)
    merged = merged.dropna(subset=["ndvi", "ndmi"], how="all")
    cloud_dropped = total_before - len(merged)

    # Average overlapping site+date rows
    merged = merged.groupby(["site_id", "date"], as_index=False).mean(numeric_only=True)
    print(f"      S2: {len(csv_paths)} files -> {len(merged):,} rows "
          f"({cloud_dropped:,} cloudy rows dropped)")
    return merged


def merge_s1_s2(s1_df: pd.DataFrame, s2_df: pd.DataFrame) -> pd.DataFrame:
    """
    Outer-join S1 and S2 on (site_id, date) so every observation is kept.

    lat/lon are handled separately from the row-level merge: both frames
    carry them, and merging two frames that both have 'lat'/'lon' columns
    makes pandas silently rename them to lat_x/lat_y/lon_x/lon_y instead of
    erroring. Instead we build one clean site-level coordinate table first
    (averaged, since a site's coordinates should be constant across rows),
    merge the indicator columns without lat/lon, then attach coordinates
    back on site_id.
    """
    if s1_df.empty and s2_df.empty:
        return pd.DataFrame(columns=["site_id", "date", "lat", "lon", "ndvi", "ndmi", "sar_vv", "sar_vh"])

    # Build one coordinate-per-site table from whichever frames have it
    coord_frames = [f[["site_id", "lat", "lon"]] for f in (s1_df, s2_df)
                     if not f.empty and "lat" in f.columns and "lon" in f.columns]
    site_coords = (pd.concat(coord_frames, ignore_index=True)
                     .groupby("site_id", as_index=False)[["lat", "lon"]].mean()
                   if coord_frames else pd.DataFrame(columns=["site_id", "lat", "lon"]))

    s1_indicators = s1_df.drop(columns=["lat", "lon"], errors="ignore")
    s2_indicators = s2_df.drop(columns=["lat", "lon"], errors="ignore")

    if s1_indicators.empty:
        merged = s2_indicators
    elif s2_indicators.empty:
        merged = s1_indicators
    else:
        merged = s1_indicators.merge(s2_indicators, on=["site_id", "date"], how="outer")

    if not site_coords.empty:
        merged = merged.merge(site_coords, on="site_id", how="left")

    merged = merged.sort_values(["site_id", "date"]).reset_index(drop=True)
    print(f"      Merged S1+S2: {len(merged):,} rows across "
          f"{merged['site_id'].nunique():,} unique sites")
    return merged


# ---------------------------------------------------------------------------
# Step 3 — Fetch weather data from Open-Meteo (with on-disk caching)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Step 3 — Fetch weather data from Open-Meteo (batched, with retry + cache)
# ---------------------------------------------------------------------------

# Open-Meteo's archive API accepts up to 1000 comma-separated locations in
# a single request. Batching turns ~9,685 sequential calls (which reliably
# hits the free-tier rate limit and starts 429ing) into ~50 batched calls,
# comfortably under any reasonable limit.
WEATHER_BATCH_SIZE = 50
WEATHER_MAX_RETRIES = 5
WEATHER_RETRY_BASE_DELAY_S = 3.0
WEATHER_BATCH_TIMEOUT_S = 60  # bigger payload per request than the old per-site call


def _safe_site_id(site_id) -> str:
    return str(site_id).replace("/", "_").replace("\\", "_").replace(" ", "_")


def _request_with_retry(params: dict, max_retries: int = WEATHER_MAX_RETRIES):
    """
    GET with exponential backoff. Honors a Retry-After header on 429s if
    Open-Meteo sends one; otherwise backs off 3s, 6s, 12s, 24s, 48s.
    Returns the parsed JSON payload, or None if every attempt failed.
    """
    for attempt in range(max_retries):
        try:
            resp = requests.get(OPEN_METEO_ARCHIVE_URL, params=params,
                                 timeout=WEATHER_BATCH_TIMEOUT_S)
            if resp.status_code == 429:
                retry_after = resp.headers.get("Retry-After")
                wait = float(retry_after) if retry_after else WEATHER_RETRY_BASE_DELAY_S * (2 ** attempt)
                
                # Print the exact text from Open-Meteo to know WHICH limit was hit
                print(f"      [rate-limit] 429 received: {resp.text.strip()}")
                print(f"      ...waiting {wait:.0f}s (attempt {attempt + 1}/{max_retries})")
                
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as exc:
            wait = WEATHER_RETRY_BASE_DELAY_S * (2 ** attempt)
            print(f"      [warn] request failed ({exc}); retrying in {wait:.0f}s "
                  f"(attempt {attempt + 1}/{max_retries})")
            time.sleep(wait)
    return None


def attach_weather(satellite_df: pd.DataFrame) -> pd.DataFrame:
    """
    Join weather data for each site onto the satellite DataFrame.

    Coordinates come straight from the satellite data's own lat/lon columns
    (NOT from master_landslide_points_ner.csv) because the two datasets use
    unrelated site_id schemes that were confirmed NOT to correspond to the
    same records.

    All sites share a single global date range (rather than each site's own
    tight min/max) so they can be requested together in Open-Meteo's
    multi-location batch calls — this is what collapses ~9,685 sequential
    requests into a handful of batched ones.
    """
    if satellite_df.empty:
        return satellite_df
    if "lat" not in satellite_df.columns or "lon" not in satellite_df.columns:
        print("      [warn] No lat/lon columns in satellite data — cannot fetch weather. "
              "Check that the raw CSVs include lat/lon and re-run Step 2.")
        return satellite_df

    site_coords = satellite_df.groupby("site_id")[["lat", "lon"]].mean()
    site_coords = site_coords.dropna()
    all_sites = list(site_coords.index)

    global_start = satellite_df["date"].min().strftime("%Y-%m-%d")
    global_end   = satellite_df["date"].max().strftime("%Y-%m-%d")

    WEATHER_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # Anything already cached from a prior (possibly interrupted) run is
    # skipped — only sites without a cache file get sent to the API.
    cached_frames = []
    to_fetch = []
    for site_id in all_sites:
        cache_path = WEATHER_CACHE_DIR / f"{_safe_site_id(site_id)}_{global_start}_{global_end}.csv"
        if cache_path.exists():
            wdf = pd.read_csv(cache_path, parse_dates=["date"])
            wdf["site_id"] = site_id
            cached_frames.append(wdf)
        else:
            to_fetch.append(site_id)

    print(f"      {len(cached_frames):,} sites already cached, "
          f"{len(to_fetch):,} to fetch via API in batches of {WEATHER_BATCH_SIZE}")

    fetched_frames = []
    total_batches = (len(to_fetch) + WEATHER_BATCH_SIZE - 1) // WEATHER_BATCH_SIZE

    for batch_num, start_idx in enumerate(range(0, len(to_fetch), WEATHER_BATCH_SIZE), start=1):
        batch_sites = to_fetch[start_idx:start_idx + WEATHER_BATCH_SIZE]
        lats = [round(float(site_coords.loc[s, "lat"]), 4) for s in batch_sites]
        lons = [round(float(site_coords.loc[s, "lon"]), 4) for s in batch_sites]

        params = {
            "latitude": ",".join(map(str, lats)),
            "longitude": ",".join(map(str, lons)),
            "start_date": global_start,
            "end_date": global_end,
            "daily": ",".join(OPEN_METEO_DAILY_VARS),
            "timezone": "auto",
        }

        payload = _request_with_retry(params)
        if payload is None:
            print(f"      [warn] batch {batch_num}/{total_batches} failed after "
                  f"{WEATHER_MAX_RETRIES} retries — skipping {len(batch_sites)} sites "
                  f"(will retry next run, nothing cached for them)")
            continue

        # Open-Meteo returns a list when multiple locations were requested,
        # a single dict for one location — normalise to a list either way.
        results = payload if isinstance(payload, list) else [payload]

        for site_id, result in zip(batch_sites, results):
            daily = result.get("daily", {}) if isinstance(result, dict) else {}
            if "time" not in daily:
                continue
            wdf = pd.DataFrame({"date": pd.to_datetime(daily["time"])})
            for var in OPEN_METEO_DAILY_VARS:
                wdf[var] = daily.get(var, [np.nan] * len(wdf))

            cache_path = WEATHER_CACHE_DIR / f"{_safe_site_id(site_id)}_{global_start}_{global_end}.csv"
            wdf.to_csv(cache_path, index=False)

            wdf = wdf.copy()
            wdf["site_id"] = site_id
            fetched_frames.append(wdf)

        print(f"      ... batch {batch_num}/{total_batches} done "
              f"({len(batch_sites)} sites)")
        time.sleep(REQUEST_PAUSE_S)

    all_frames = cached_frames + fetched_frames
    matched = len(all_frames)
    print(f"      Weather data obtained for {matched:,}/{len(all_sites):,} sites")
    if not all_frames:
        return satellite_df

    all_weather = pd.concat(all_frames, ignore_index=True)
    merged = satellite_df.merge(all_weather, on=["site_id", "date"], how="left")
    return merged


# ---------------------------------------------------------------------------
# Step 4 — Fill temporal gaps to a uniform daily grid per site
# ---------------------------------------------------------------------------

def _add_staleness_columns(group: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    """
    For each column in `cols`, add a `<col>_days_since_obs` column giving
    the number of days to the NEAREST real (non-null) observation.

    Must be called on a date-indexed, already-reindexed-to-daily-grid
    frame, BEFORE ffill/bfill — it relies on NaN meaning "no real reading
    on this day".

    0   = this row IS a real observation
    N>0 = nearest real observation is N days away (before or after)
    """
    idx_series = pd.Series(group.index, index=group.index)
    for col in cols:
        if col not in group.columns:
            continue
        observed_dates = idx_series.where(group[col].notna())
        forward = observed_dates.ffill()   # nearest real obs at or before this day
        backward = observed_dates.bfill()  # nearest real obs at or after this day

        dist_fwd = (idx_series - forward).dt.days
        dist_bwd = (backward - idx_series).dt.days

        dist = pd.concat([dist_fwd, dist_bwd], axis=1).min(axis=1, skipna=True)
        # A site with NO real observations for this column at all -> leave NaN
        group[f"{col}_days_since_obs"] = dist
    return group


def fill_gaps(df: pd.DataFrame, progress_every: int = 1000) -> pd.DataFrame:
    """Reindex each site to a continuous daily grid, add staleness columns,
    then ffill + bfill the actual values."""
    if df.empty:
        return df

    value_cols = [c for c in df.columns if c not in ("site_id", "date")]
    staleness_cols = [c for c in SATELLITE_INDICATOR_COLS if c in value_cols]

    filled_frames = []
    sites = df["site_id"].unique()
    total = len(sites)

    for i, site_id in enumerate(sites):
        if (i + 1) % progress_every == 0 or (i + 1) == total:
            print(f"      ... gap-fill: {i+1}/{total} sites")

        group = df[df["site_id"] == site_id].sort_values("date").set_index("date")
        full_range = pd.date_range(group.index.min(), group.index.max(), freq="D")
        group = group.reindex(full_range)
        group.index.name = "date"

        # Staleness must be computed BEFORE ffill/bfill overwrites the NaNs
        group = _add_staleness_columns(group, staleness_cols)

        group[value_cols] = group[value_cols].ffill().bfill()
        group["site_id"] = site_id
        filled_frames.append(group.reset_index())

    result = pd.concat(filled_frames, ignore_index=True)
    return result


# ---------------------------------------------------------------------------
# Test-mode — synthetic data for pipeline validation
# ---------------------------------------------------------------------------

def make_synthetic_inputs():
    print("[test-mode] Generating synthetic sites + satellite readings...")
    sites_df = pd.DataFrame({
        "site_id": ["test_site_001", "test_site_002", "test_site_003"],
        "latitude": [25.58, 26.14, 27.10],
        "longitude": [91.89, 91.73, 93.60],
    })

    rows = []
    for sid in sites_df["site_id"]:
        lat = sites_df.loc[sites_df.site_id == sid, "latitude"].iloc[0]
        lon = sites_df.loc[sites_df.site_id == sid, "longitude"].iloc[0]
        dates = pd.date_range("2024-06-01", "2024-06-10", freq="3D")
        for d in dates:
            rows.append({
                "site_id": sid, "date": d, "lat": lat, "lon": lon,
                "ndvi": np.random.uniform(0.2, 0.8),
                "ndmi": np.random.uniform(-0.2, 0.4),
                "sar_vv": np.random.uniform(-20, -5),
                "sar_vh": np.random.uniform(-25, -10),
            })
    return sites_df, pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Merge GEE satellite CSVs + Open-Meteo weather, fill gaps."
    )
    parser.add_argument("--skip-weather", action="store_true",
                        help="Skip the Open-Meteo API calls")
    parser.add_argument("--test-mode", action="store_true",
                        help="Run on synthetic data instead of real files")
    args = parser.parse_args()

    # -- Step 1: Site metadata ----------------------------------------------
    if args.test_mode:
        sites_df, satellite_df = make_synthetic_inputs()
    else:
        print(f"[1/4] Loading site metadata from {RAW_LANDSLIDE_CSV.name} ...")
        sites_df = load_site_metadata()
        print(f"      [OK] {len(sites_df):,} sites loaded.\n")

        # -- Step 2: Load satellite data ------------------------------------
        print("[2/4] Loading satellite CSVs ...")
        s1_df = load_s1_batches()
        s2_df = load_s2_batches()
        satellite_df = merge_s1_s2(s1_df, s2_df)
        print()

    if satellite_df.empty:
        print("Nothing to process — no satellite rows available. Exiting.")
        sys.exit(0)

    # -- Step 3: Weather ----------------------------------------------------
    if args.skip_weather:
        print("[3/4] Skipping weather join (--skip-weather).\n")
        combined = satellite_df
    else:
        print("[3/4] Fetching weather data from Open-Meteo (cached per site)...")
        combined = attach_weather(satellite_df)
        print()

    # -- Step 4: Gap-fill ---------------------------------------------------
    print("[4/4] Forward/backward-filling temporal gaps per site (+ staleness cols)...")
    aligned = fill_gaps(combined)

    # -- Save ---------------------------------------------------------------
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out_path = PROCESSED_DIR / "aligned_dataset.csv"

    print(f"      Writing {len(aligned):,} rows to CSV in chunks to save memory...")
    aligned.to_csv(out_path, index=False, chunksize=100000)

    print(f"\n{'='*60}")
    print(f"  [OK] Done!  {len(aligned):,} rows  x  {len(aligned.columns)} columns")
    print(f"  [OK] Sites: {aligned['site_id'].nunique():,}")
    print(f"  [OK] Date range: {aligned['date'].min()} -> {aligned['date'].max()}")
    print(f"  [OK] Saved to: {out_path}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()