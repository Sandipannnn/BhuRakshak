"""
Bhurakshak — Step 1: GEE bulk export of historical Sentinel-1/Sentinel-2
time series (NDVI, NDMI, SAR VV/VH) for transformer training.

Produces one CSV per point (or one combined CSV) with columns:
    lat, lon, date, source, ndvi, ndmi, sar_vv, sar_vh, cloud_pct

Design notes:
- Sentinel-2 and Sentinel-1 are queried independently, since they have
  different revisit cadences. Rows are NOT pre-aligned to a shared
  timestep here — that alignment (+ weather join + gap_days computation)
  happens in the next pipeline stage (preprocessing script), so this
  script's only job is to get clean per-acquisition satellite values out
  of GEE as fast and reliably as possible.
- Cloud-affected Sentinel-2 pixels are masked at the pixel level using the
  SCL (Scene Classification Layer) before computing NDVI/NDMI, and each
  export row also carries a cloud_pct field (from the image's
  CLOUDY_PIXEL_PERCENTAGE property) so the preprocessing stage can decide
  whether to trust, forward-fill, or drop a given value.
- Sentinel-1 is not cloud-masked (radar penetrates cloud); VV/VH are
  extracted directly from the GRD collection.

SETUP:
    pip install earthengine-api
    earthengine authenticate      # one-time browser auth
    # or, for a service account (recommended for unattended/CI runs):
    #   ee.Initialize(ee.ServiceAccountCredentials(EMAIL, KEY_FILE))

USAGE:
    python gee_export_satellite_timeseries.py

    Edit the CONFIG block below first: POINTS, START_DATE, END_DATE,
    OUTPUT_MODE (local CSV via getInfo for small jobs, or Drive export
    task for larger jobs — see note near EXPORT_MODE).
"""

import ee
import csv
import os
import time
import sys

# --------------------------------------------------------------------------
# CONFIG — edit these before running
# --------------------------------------------------------------------------

# Path to the CSV produced by Extract_landslide_points.py.
# Each row must have at minimum: lat, lon columns.
# Optional columns used if present: state, date, ls_type.
POINTS_CSV = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "master_landslide_points_ner.csv",
)

START_DATE = "2019-01-01"
END_DATE = "2026-08-31"

# Buffer radius (meters) around each point for the mean-pixel-value query.
# A small buffer (e.g. 30-60m) smooths single-pixel noise without blurring
# past the slope feature you care about.
BUFFER_M = 30

# "local"  -> pulls results directly via getInfo(), writes CSV to disk here.
#             Simple, but GEE will throttle/reject very large requests.
#             Fine for a handful of points / a few years.
# "drive"  -> submits a batch Export.table.toDrive task per satellite,
#             which GEE runs server-side and drops a CSV in your Google
#             Drive. Use this once POINTS gets large (dozens+) or the
#             date range is long — it's the scalable path.
EXPORT_MODE = "drive"

# Maximum points to process (set to None for all). Useful for testing.
MAX_POINTS = None

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))


def load_points_from_csv(csv_path, max_points=None):
    """Read the COOLR CSV and return a list of (name, lat, lon) tuples."""
    points = []
    seen = set()  # deduplicate by (lat, lon) rounded to 4 decimals
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            lat = float(row["lat"])
            lon = float(row["lon"])
            key = (round(lat, 4), round(lon, 4))
            if key in seen:
                continue
            seen.add(key)
            state = row.get("state", "unknown")
            name = f"{state}_{len(points):04d}"
            points.append((name, lat, lon))
            if max_points and len(points) >= max_points:
                break
    print(f"Loaded {len(points)} unique points from {csv_path}")
    return points


# Load points from CSV
POINTS = load_points_from_csv(POINTS_CSV, MAX_POINTS) if os.path.exists(POINTS_CSV) else []

# Google Cloud project registered for Earth Engine.
# Find yours at https://console.cloud.google.com or in the EE Code Editor.
GEE_PROJECT = "vivid-alchemy-505710-c0"

# --------------------------------------------------------------------------

def init_ee(project=GEE_PROJECT):
    """Authenticate and initialise the Earth Engine API.

    The EE Python client requires an explicit project argument.
    We also specify the high-volume endpoint which is recommended
    for scripts that make many getInfo() or export calls.
    """
    try:
        ee.Initialize(project=project, opt_url='https://earthengine-highvolume.googleapis.com')
    except Exception as exc:
        print(f"Earth Engine initialization failed ({exc}). Trying to authenticate...")
        try:
            ee.Authenticate()
            ee.Initialize(project=project, opt_url='https://earthengine-highvolume.googleapis.com')
        except Exception as auth_exc:
            raise RuntimeError(
                f"Failed to initialize Earth Engine with project '{project}'.\n"
                "1. Check your Google Cloud project ID in GEE_PROJECT.\n"
                "2. Ensure the Earth Engine API is enabled for this project.\n"
                "3. Try running `earthengine authenticate` from your terminal if this script hangs."
            ) from auth_exc


def mask_s2_clouds(image):
    """Mask clouds/shadow using the Scene Classification Layer (SCL).
    Keeps: vegetation(4), bare soil(5), water(6), snow(11) — i.e. drops
    cloud, cloud shadow, cirrus, and saturated/defective pixel classes."""
    scl = image.select("SCL")
    good = scl.eq(4).Or(scl.eq(5)).Or(scl.eq(6)).Or(scl.eq(11))
    return image.updateMask(good)


def add_s2_indices(image):
    ndvi = image.normalizedDifference(["B8", "B4"]).rename("ndvi")
    ndmi = image.normalizedDifference(["B8", "B11"]).rename("ndmi")
    return image.addBands([ndvi, ndmi])


def get_sentinel2_series(point, start, end, buffer_m):
    """Returns a list of dicts: date, ndvi, ndmi, cloud_pct for one point."""
    geom = ee.Geometry.Point([point[2], point[1]]).buffer(buffer_m)

    coll = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(geom)
        .filterDate(start, end)
        .map(mask_s2_clouds)
        .map(add_s2_indices)
    )

    def reduce_image(image):
        stats = image.select(["ndvi", "ndmi"]).reduceRegion(
            reducer=ee.Reducer.mean(), geometry=geom, scale=10, maxPixels=1e9
        )
        return ee.Feature(
            None,
            {
                "date": image.date().format("YYYY-MM-dd"),
                "ndvi": stats.get("ndvi"),
                "ndmi": stats.get("ndmi"),
                "cloud_pct": image.get("CLOUDY_PIXEL_PERCENTAGE"),
            },
        )

    fc = ee.FeatureCollection(coll.map(reduce_image))
    return fc


def get_sentinel1_series(point, start, end, buffer_m):
    """Returns a FeatureCollection: date, sar_vv, sar_vh for one point."""
    geom = ee.Geometry.Point([point[2], point[1]]).buffer(buffer_m)

    coll = (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterBounds(geom)
        .filterDate(start, end)
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
    )

    def reduce_image(image):
        stats = image.select(["VV", "VH"]).reduceRegion(
            reducer=ee.Reducer.mean(), geometry=geom, scale=10, maxPixels=1e9
        )
        return ee.Feature(
            None,
            {
                "date": image.date().format("YYYY-MM-dd"),
                "sar_vv": stats.get("VV"),
                "sar_vh": stats.get("VH"),
            },
        )

    fc = ee.FeatureCollection(coll.map(reduce_image))
    return fc


def fc_to_rows(fc, extra_fields, point_name, lat, lon, source):
    """Pulls a small/medium FeatureCollection to local Python via getInfo()."""
    features = fc.getInfo()["features"]
    rows = []
    for f in features:
        props = f["properties"]
        row = {"site": point_name, "lat": lat, "lon": lon, "source": source}
        row.update({k: props.get(k) for k in extra_fields})
        rows.append(row)
    return rows


def export_local(points, start, end, buffer_m, output_dir):
    all_rows = []
    for name, lat, lon in points:
        print(f"[Sentinel-2] {name} ({lat}, {lon}) ...")
        s2_fc = get_sentinel2_series((name, lat, lon), start, end, buffer_m)
        s2_rows = fc_to_rows(
            s2_fc, ["date", "ndvi", "ndmi", "cloud_pct"], name, lat, lon, "sentinel2"
        )
        all_rows.extend(s2_rows)
        print(f"    -> {len(s2_rows)} acquisitions")

        print(f"[Sentinel-1] {name} ({lat}, {lon}) ...")
        s1_fc = get_sentinel1_series((name, lat, lon), start, end, buffer_m)
        s1_rows = fc_to_rows(
            s1_fc, ["date", "sar_vv", "sar_vh"], name, lat, lon, "sentinel1"
        )
        all_rows.extend(s1_rows)
        print(f"    -> {len(s1_rows)} acquisitions")

        time.sleep(0.5)  # be gentle with getInfo() calls

    out_path = f"{output_dir}/satellite_timeseries_raw.csv"
    fieldnames = ["site", "lat", "lon", "source", "date", "ndvi", "ndmi",
                  "cloud_pct", "sar_vv", "sar_vh"]
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in all_rows:
            full_row = {k: row.get(k, "") for k in fieldnames}
            writer.writerow(full_row)

    print(f"\nWrote {len(all_rows)} rows to {out_path}")
    print("NOTE: rows are NOT yet aligned/deduplicated across S1 and S2 or "
          "joined with weather data — that happens in the preprocessing "
          "stage (step 3).")
    return out_path


def export_drive(points, start, end, buffer_m, batch_size=50):
    """Submits batched Export.table.toDrive tasks grouped by state.
    Instead of 1 task per point (which would create ~1800 tasks for 917 points),
    this batches points into groups and merges the FeatureCollections before
    exporting, resulting in far fewer (and larger) CSV files on Google Drive.

    Check progress at code.earthengine.google.com/tasks, or via
    ee.batch.Task.list()."""
    tasks = []
    total = len(points)

    for i in range(0, total, batch_size):
        batch = points[i : i + batch_size]
        batch_num = i // batch_size
        batch_label = f"batch{batch_num:03d}"

        print(f"\n[Batch {batch_num}] Processing points {i+1}-{min(i+batch_size, total)} of {total} ...")

        # Collect FeatureCollections for this batch
        s2_fcs = []
        s1_fcs = []
        for name, lat, lon in batch:
            # Add site name, lat, lon as properties so we can identify rows later
            s2_fc = get_sentinel2_series((name, lat, lon), start, end, buffer_m)
            s2_fc = s2_fc.map(lambda f, n=name, la=lat, lo=lon: f.set({"site": n, "lat": la, "lon": lo, "source": "sentinel2"}))
            s2_fcs.append(s2_fc)

            s1_fc = get_sentinel1_series((name, lat, lon), start, end, buffer_m)
            s1_fc = s1_fc.map(lambda f, n=name, la=lat, lo=lon: f.set({"site": n, "lat": la, "lon": lo, "source": "sentinel1"}))
            s1_fcs.append(s1_fc)

        # Merge all FCs in this batch into one
        merged_s2 = ee.FeatureCollection(s2_fcs).flatten()
        merged_s1 = ee.FeatureCollection(s1_fcs).flatten()

        # Submit export tasks
        t_s2 = ee.batch.Export.table.toDrive(
            collection=merged_s2,
            description=f"bhurakshak_s2_{batch_label}",
            folder="BhuRakshak_GEE",
            fileFormat="CSV",
        )
        t_s1 = ee.batch.Export.table.toDrive(
            collection=merged_s1,
            description=f"bhurakshak_s1_{batch_label}",
            folder="BhuRakshak_GEE",
            fileFormat="CSV",
        )
        t_s2.start()
        t_s1.start()
        tasks.extend([t_s2, t_s1])
        print(f"    Submitted S1 + S2 export tasks for {batch_label} ({len(batch)} points).")

        time.sleep(1)  # small delay to avoid hammering the API

    print(f"\n{'='*60}")
    print(f"{len(tasks)} export tasks submitted to Google Earth Engine.")
    print(f"CSVs will appear in your Google Drive folder: BhuRakshak_GEE/")
    print(f"Monitor progress at: https://code.earthengine.google.com/tasks")
    print(f"{'='*60}")
    return tasks


def main():
    init_ee()

    if not POINTS:
        print("No POINTS configured — edit the CONFIG block first.")
        sys.exit(1)

    if EXPORT_MODE == "local":
        export_local(POINTS, START_DATE, END_DATE, BUFFER_M, OUTPUT_DIR)
    elif EXPORT_MODE == "drive":
        export_drive(POINTS, START_DATE, END_DATE, BUFFER_M)
    else:
        print(f"Unknown EXPORT_MODE: {EXPORT_MODE}")
        sys.exit(1)


if __name__ == "__main__":
    main()