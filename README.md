# ⛰️ BhuRakshak - SIH 2026

**BhuRakshak** is an AI-powered Early Warning System for landslide prediction, developed for the **Smart India Hackathon (SIH) 2026**. 
It focuses on the highly vulnerable Northeast region of India, utilizing satellite imagery (Sentinel-1 SAR and Sentinel-2 Optical) and deep learning (Transformer Neural Networks) to predict landslide susceptibility based on real-time environmental precursors.

---

## 🏗️ Project Architecture & Pipeline

The BhuRakshak pipeline is divided into distinct phases:

1. **Data Collection (Completed)**
   - **NASA COOLR Inventory:** Extracted 917 landslide coordinate points.
   - **GSI Landslide Inventory:** Directly queried the open Bharatlas data mirror to extract 10,408 official landslide records across Northeast India.
   - **Master Dataset:** Merged, filtered, and spatially deduplicated both datasets (100m radius threshold) to yield **9,682 unique historic landslide sites**.

2. **Satellite Extraction via Google Earth Engine (Completed)**
   - Batch-exported time-series profiles for all 9,682 coordinates over a 5-year window.
   - **Optical Indicators (Sentinel-2):** NDVI (Vegetation), NDMI (Soil Moisture).
   - **Radar Indicators (Sentinel-1):** SAR VV & VH (Surface Roughness & Ground Displacement).
   - *Outputs are generated server-side by Google Earth Engine and saved directly as CSV files in Google Drive (`BhuRakshak_GEE/`).*

3. **Data Preprocessing & Alignment (Next Step)**
   - Merge GEE CSV batches.
   - Join with IMD/ERA5 live weather/precipitation data.
   - Forward/backward fill temporal gaps to create uniform sequences for the AI model.

4. **Transformer AI Model (Upcoming)**
   - PyTorch-based sequence-to-sequence Temporal Transformer model.
   - Evaluates past `n` days of satellite + weather data to predict the percentage probability of a landslide occurring in the next `t` hours.

5. **Deployment & Dashboard (Upcoming)**
   - Interactive Web GIS map.
   - Automated hazard alerts.

---

## 📁 Repository Structure

```text
BhuRakshak/
│
├── 📂 data/                                 # [Local Data - Ignored in Git]
│   ├── 📂 raw/                              # Raw downloaded spatial inventories
│   │   ├── landslide/
│   │   └── satellite/                       # CSVs downloaded from Google Drive
│   │
│   ├── 📂 processed/                        # Merged & processed spatial datasets
│   │   └── master_landslide_points_ner.csv  # 9,682 deduplicated landslide sites
│   │
│   └── 📂 shapefiles/                       # GIS Shapefile exports
│
├── 📂 src/                                  # [Source Code Modules]
│   ├── 📂 data_collection/                  # Data Extraction Scripts
│   │   ├── Extract_landslide_points.py      # NASA COOLR extractor
│   │   ├── download_ngdr_landslide.py       # GSI Inventory downloader
│   │   ├── merge_landslide_datasets.py      # Master dataset merger & deduplicator
│   │   └── GEE_export_satelite_timeseries.py# Google Earth Engine batch exporter
│   │
│   ├── 📂 preprocessing/                    # [Pending]
│   ├── 📂 models/                           # [Pending]
│   └── 📂 api/                              # [Pending]
│
└── 📂 web/                                  # [Pending] Interactive GIS Dashboard
```

---

## 🚀 How to Run the Data Collection Pipeline

**Step 1: Install Dependencies**
```bash
pip install earthengine-api pandas geopandas requests pyogrio shapely fiona
```

**Step 2: Authenticate Earth Engine**
```bash
earthengine authenticate
```

**Step 3: Run Extractors**
```bash
# 1. Download NASA data
python src/data_collection/Extract_landslide_points.py

# 2. Download GSI data (Northeast filter)
python src/data_collection/download_ngdr_landslide.py

# 3. Merge & Deduplicate
python src/data_collection/merge_landslide_datasets.py

# 4. Trigger Google Earth Engine Satellite Extraction to Google Drive
python src/data_collection/GEE_export_satelite_timeseries.py
```
*(Once GEE finishes processing, download the `BhuRakshak_GEE/` folder from your Google Drive and place the CSVs inside `data/raw/satellite/`)*