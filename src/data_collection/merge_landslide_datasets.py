import os
import pandas as pd

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))
COOLR_CSV = os.path.join(OUTPUT_DIR, "coolr_landslide_points_ner.csv")
GSI_CSV = os.path.join(OUTPUT_DIR, "gsi_landslide_points_ner.csv")
MASTER_CSV = os.path.join(OUTPUT_DIR, "master_landslide_points_ner.csv")


def main():
    print("=" * 65)
    print(" MERGING LANDSLIDE DATASETS (NASA COOLR + GSI INVENTORY)")
    print("=" * 65)

    records = []

    # 1. Process NASA COOLR
    if os.path.exists(COOLR_CSV):
        df_coolr = pd.read_csv(COOLR_CSV)
        print(f"[1] Loaded {len(df_coolr)} points from NASA COOLR dataset.")
        for _, row in df_coolr.iterrows():
            records.append({
                "lat": round(float(row["lat"]), 5),
                "lon": round(float(row["lon"]), 5),
                "source": "NASA_COOLR",
                "state": row.get("state", "NER"),
                "date": row.get("date", ""),
                "ls_type": row.get("ls_type", ""),
                "trigger": row.get("trigger", ""),
            })

    # 2. Process GSI Inventory
    if os.path.exists(GSI_CSV):
        df_gsi = pd.read_csv(GSI_CSV)
        print(f"[2] Loaded {len(df_gsi)} points from GSI Inventory dataset.")
        for _, row in df_gsi.iterrows():
            lat = row.get("LATITUDE") or row.get("latitude")
            lon = row.get("LONGITUDE") or row.get("longitude")
            if pd.isna(lat) or pd.isna(lon):
                continue
            records.append({
                "lat": round(float(lat), 5),
                "lon": round(float(lon), 5),
                "source": "GSI_INVENTORY",
                "state": row.get("STATE", "NER"),
                "date": "",
                "ls_type": row.get("MOVEMENT_TYPE", ""),
                "trigger": row.get("TRIGGERING", ""),
            })

    df_master = pd.DataFrame(records)
    print(f"\n[3] Total combined raw records: {len(df_master)}")

    # Deduplicate by rounding lat/lon to ~100m (3 decimal places)
    df_master["lat_round"] = df_master["lat"].round(3)
    df_master["lon_round"] = df_master["lon"].round(3)
    df_dedup = df_master.drop_duplicates(subset=["lat_round", "lon_round"]).copy()
    df_dedup = df_dedup.drop(columns=["lat_round", "lon_round"])

    # Assign unique ID
    df_dedup["site_id"] = [f"point_{i+1:05d}" for i in range(len(df_dedup))]
    
    # Save
    df_dedup.to_csv(MASTER_CSV, index=False)
    print(f"[4] Deduplicated unique points: {len(df_dedup)}")
    print(f"    Saved Master Dataset to: {MASTER_CSV}")
    print("=" * 65)


if __name__ == "__main__":
    main()
