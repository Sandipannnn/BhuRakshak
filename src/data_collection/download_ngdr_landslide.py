import os
import requests
import pandas as pd
import geopandas as gpd

# ============================================================
# GSI LANDSLIDE INVENTORY DOWNLOADER (via Bharatlas Open Data)
# ============================================================

DATA_URL = "https://pub-0429b8e3b5a946e69ea007df844a6f1c.r2.dev/environment/gsi-landslide-inventory/GSI_Landslide_Inventory.geojson"

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
GEOJSON_PATH = os.path.join(OUTPUT_DIR, "gsi_landslide_inventory_raw.geojson")
CSV_PATH = os.path.join(OUTPUT_DIR, "gsi_landslide_points_ner.csv")
SHP_DIR = os.path.join(OUTPUT_DIR, "gsi_landslide_shapefile")

# Northeast Region Bounding Box (covering AP, Assam, Manipur, Meghalaya, Nagaland, Tripura, Sikkim, Mizoram)
NER_BBOX = (87.5, 21.5, 97.5, 29.5)  # min_lon, min_lat, max_lon, max_lat


def download_data():
    print(f"[1/3] Downloading GSI Landslide Inventory dataset from open mirror...")
    if os.path.exists(GEOJSON_PATH):
        print(f"    Already downloaded: {GEOJSON_PATH}")
        return GEOJSON_PATH

    r = requests.get(DATA_URL, stream=True, timeout=120)
    r.raise_for_status()

    total_size = int(r.headers.get("content-length", 0))
    downloaded = 0

    with open(GEOJSON_PATH, "wb") as f:
        for chunk in r.iter_content(chunk_size=1024 * 1024):
            if chunk:
                f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0:
                    pct = (downloaded / total_size) * 100
                    print(f"\r    Progress: {downloaded / (1024*1024):.1f} MB / {total_size / (1024*1024):.1f} MB ({pct:.1f}%)", end="")
    print(f"\n    Saved raw dataset to: {GEOJSON_PATH}")
    return GEOJSON_PATH


def process_data(geojson_file):
    print("\n[2/3] Loading and filtering spatial dataset for Northeast India...")
    gdf = gpd.read_file(geojson_file)
    print(f"    Total features in pan-India dataset: {len(gdf)}")

    min_lon, min_lat, max_lon, max_lat = NER_BBOX
    ner_gdf = gdf.cx[min_lon:max_lon, min_lat:max_lat].copy()
    print(f"    Filtered Northeast Region features: {len(ner_gdf)}")

    # Extract coordinates
    if ner_gdf.geometry.notna().any():
        centroids = ner_gdf.geometry.centroid
        ner_gdf["longitude"] = centroids.x
        ner_gdf["latitude"] = centroids.y

    # Save CSV
    print(f"\n[3/3] Exporting processed outputs...")
    df = ner_gdf.drop(columns="geometry", errors="ignore")
    df.to_csv(CSV_PATH, index=False)
    print(f"    CSV saved: {CSV_PATH} ({len(df)} records)")

    # Save Shapefile
    os.makedirs(SHP_DIR, exist_ok=True)
    shp_path = os.path.join(SHP_DIR, "gsi_landslide_ner.shp")
    ner_gdf.to_file(shp_path, driver="ESRI Shapefile")
    print(f"    Shapefile saved: {shp_path}")

    print("\n" + "=" * 65)
    print("SUCCESS! GSI Landslide dataset ready.")
    print("=" * 65)


def main():
    print("=" * 65)
    print(" GSI INDIA & NORTHEAST LANDSLIDE INVENTORY DOWNLOADER")
    print("=" * 65)
    geojson = download_data()
    process_data(geojson)


if __name__ == "__main__":
    main()