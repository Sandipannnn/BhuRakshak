"""
Bhurakshak — extract historical landslide event lat/lon points for
Arunachal Pradesh, Assam, Manipur, Meghalaya, Nagaland, Tripura.



1. NASA COOLR (Global Landslide Catalog + citizen reports)
   -> Has a public, queryable ArcGIS REST FeatureServer. Fully scriptable.
   -> This script pulls it directly. No auth needed.

2. ISRO/NRSC Landslide Atlas (Bhuvan)
   -> Bhuvan runs WFS/WMS (GeoServer) endpoints, but the *exact* layer
      name for the Landslide Atlas inventory isn't published anywhere
      I could confirm. Guessing a layer name and silently returning
      nothing (or the wrong layer) would be worse than being explicit
      about it. This script includes a `discover_bhuvan_landslide_layer()`
      helper that queries WFS GetCapabilities and searches for anything
      with "landslide" in the name — run that first, confirm the layer
      name it finds, then use `fetch_bhuvan_wfs()` with that name.

3. GSI Bhukosh (bhukosh.gsi.gov.in)
   -> Appears to be a search/browse portal with no documented public API.
      Practical path: use it as a manual cross-reference (search by
      district, note landslide site names/approximate locations), not
      as an automated source. Not scripted here.

USAGE:
    pip install requests
    python extract_landslide_points.py
"""

import requests
import csv
import time
import os

# --------------------------------------------------------------------------
# Bounding boxes per state (rough, generous rectangles — will pull points
# slightly outside the state border too; filter/clip more precisely later
# if you need exact state boundaries, e.g. with a shapefile + geopandas).
# Format: (min_lon, min_lat, max_lon, max_lat)
# --------------------------------------------------------------------------
STATE_BBOXES = {
    "arunachal_pradesh": (91.5, 26.6, 97.5, 29.5),
    "assam":             (89.7, 24.1, 96.1, 28.2),
    "manipur":           (93.0, 23.8, 94.8, 25.7),
    "meghalaya":         (89.8, 25.0, 92.8, 26.2),
    "nagaland":          (93.3, 25.1, 95.3, 27.1),
    "tripura":           (91.1, 22.9, 92.4, 24.6),
}

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------
# 1. NASA COOLR — confirmed working REST API
# --------------------------------------------------------------------------
COOLR_EVENTS_URL = (
    "https://services9.arcgis.com/RrvMEynxDB8hycVO/arcgis/rest/services/"
    "nasa_global_landslide_catalog_point/FeatureServer/0/query"
)


def fetch_coolr_points(bbox, layer_url=COOLR_EVENTS_URL, timeout=30):
    """Query the COOLR ArcGIS FeatureServer for points inside bbox.
    Returns a list of dicts: lat, lon, date, ls_type, trigger, source."""
    min_lon, min_lat, max_lon, max_lat = bbox
    params = {
        "where": "1=1",
        "outFields": "*",
        "geometry": f"{min_lon},{min_lat},{max_lon},{max_lat}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outSR": "4326",
        "f": "geojson",
        "resultRecordCount": 2000,  # server MaxRecordCount
    }
    resp = requests.get(layer_url, params=params, timeout=timeout)
    resp.raise_for_status()
    data = resp.json()

    rows = []
    for feat in data.get("features", []):
        geom = feat.get("geometry") or {}
        coords = geom.get("coordinates")
        if not coords or len(coords) < 2:
            continue
        lon, lat = coords[0], coords[1]
        props = feat.get("properties", {})
        
        # NASA's ArcGIS date format is typically epoch ms
        date_val = props.get("ev_date")
        if date_val and isinstance(date_val, (int, float)):
            # convert epoch ms to YYYY-MM-DD
            import datetime
            date_str = datetime.datetime.fromtimestamp(date_val / 1000.0).strftime('%Y-%m-%d')
        else:
            date_str = str(date_val) if date_val else ""
            
        rows.append({
            "lat": lat,
            "lon": lon,
            "date": date_str,
            "ls_type": props.get("ls_cat") or props.get("ls_type"),
            "trigger": props.get("ls_trig") or props.get("trigger"),
            "source": props.get("ev_imp_src", "GLC/COOLR"),
        })
    return rows


def extract_all_coolr(state_bboxes, output_dir):
    all_rows = []
    for state, bbox in state_bboxes.items():
        print(f"[COOLR] Querying {state} ...")
        try:
            rows = fetch_coolr_points(bbox)
        except Exception as e:
            print(f"    FAILED: {e}")
            continue
        for r in rows:
            r["state"] = state
        all_rows.extend(rows)
        print(f"    -> {len(rows)} points")
        time.sleep(0.5)

    out_path = f"{output_dir}/coolr_landslide_points_ner.csv"
    fieldnames = ["state", "lat", "lon", "date", "ls_type", "trigger", "source"]
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in all_rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})

    print(f"\nWrote {len(all_rows)} COOLR points to {out_path}")
    if len(all_rows) == 0:
        print("NOTE: zero results can mean (a) genuinely sparse NER "
              "coverage in COOLR — plausible, since COOLR skews toward "
              "media-reported/high-fatality events and NER landslides are "
              "under-reported internationally — or (b) a field-name "
              "mismatch in outFields (ArcGIS field names vary by service; "
              "if this returns 0, fetch one record with outFields=* and "
              "print raw properties to see actual field names before "
              "assuming there's no data).")
    return out_path


# --------------------------------------------------------------------------
# 2. Bhuvan WFS — layer name must be discovered first, not guessed
# --------------------------------------------------------------------------
BHUVAN_WFS_CANDIDATES = [
    "https://bhuvan-vec1.nrsc.gov.in/bhuvan/wms",
    "https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms",
]


def discover_bhuvan_landslide_layer(candidate_urls=BHUVAN_WFS_CANDIDATES):
    """Queries WFS GetCapabilities on each candidate endpoint and prints
    any layer whose name/title mentions 'landslide'. Run this FIRST — do
    not assume a layer name without checking, Bhuvan's naming is not
    documented publicly in a stable way."""
    found_any = False
    for base in candidate_urls:
        wfs_url = base.replace("/wms", "/wfs") if "/wms" in base else base
        params = {"service": "WFS", "version": "2.0.0", "request": "GetCapabilities"}
        print(f"Checking {wfs_url} ...")
        try:
            resp = requests.get(wfs_url, params=params, timeout=20)
            resp.raise_for_status()
        except Exception as e:
            print(f"    FAILED: {e}")
            continue

        text = resp.text.lower()
        if "landslide" in text:
            found_any = True
            # crude scan for surrounding layer name tags
            import re
            names = re.findall(r"<name>([^<]*landslide[^<]*)</name>", text)
            print(f"    Found candidate layer name(s): {names or '(matched but could not isolate <Name> tag — inspect raw response manually)'}")
        else:
            print("    No 'landslide' match in capabilities response.")
    if not found_any:
        print("\nNo landslide layer found via WFS GetCapabilities on the "
              "checked endpoints. Next step: log into bhuvan.nrsc.gov.in, "
              "open the Landslide Atlas viewer directly, and use browser "
              "dev tools (Network tab) to capture the actual data request "
              "the map makes when you pan/zoom — that reveals the real "
              "endpoint and layer name being used, which can then be "
              "scripted the same way as the COOLR query above.")


def fetch_bhuvan_wfs(base_url, layer_name, bbox, timeout=30):
    """Once you've confirmed a real layer name via discover_bhuvan_landslide_layer()
    (or the browser Network-tab method), use this to pull features."""
    min_lon, min_lat, max_lon, max_lat = bbox
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeName": layer_name,
        "outputFormat": "application/json",
        "bbox": f"{min_lon},{min_lat},{max_lon},{max_lat},EPSG:4326",
    }
    resp = requests.get(base_url, params=params, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


if __name__ == "__main__":
    print("=== Step 1: NASA COOLR (working API) ===")
    extract_all_coolr(STATE_BBOXES, OUTPUT_DIR)

    print("\n=== Step 2: Bhuvan landslide layer discovery ===")
    discover_bhuvan_landslide_layer()

    print("\n=== Step 3: GSI Bhukosh ===")
    print("No public API confirmed. Use bhukosh.gsi.gov.in manually: "
          "search by state/district, note approximate coordinates of "
          "listed landslide sites, and add them to your points list by "
          "hand, or treat it as a citation/cross-check source rather "
          "than a bulk data feed.")