# 🌍 BhuRakshak

> **AI-Based Landslide Risk Monitoring System for Northeast India**
> Built for **SIH26001** — Smart India Hackathon 2026

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Backend-teal.svg)](https://fastapi.tiangolo.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Google Earth Engine](https://img.shields.io/badge/Earth_Engine-Supported-orange.svg)](https://earthengine.google.com/)

BhuRakshak is a landslide susceptibility system tailored for Northeast India. It combines **Sentinel-1 SAR**, **Sentinel-2 optical indicators**, and historical **landslide inventory labels** with a temporal **Transformer model**, served through a **FastAPI backend** that powers a GIS risk heatmap and a field-reporting workflow.

---

## 🎯 Current Scope

The trained model predicts **landslide susceptibility**:

> _"How likely is this location to be historically landslide-prone based on its recent 30-day satellite sequence?"_

⚠️ **Note:** It does not predict whether a landslide will happen in the next few hours (early-warning). That task requires dated event records overlapping the satellite observation period and will be added as a separate training workflow when the required schema is available.

---

## ⚙️ Pipeline Overview

1. **Data Aggregation** — Collect and merge multiple landslide inventories.
2. **Satellite Export** — Export Sentinel-1 and Sentinel-2 time series via Google Earth Engine.
3. **Temporal Alignment** — Align satellite observations to a daily grid and engineer observation-staleness features.
4. **Dataset Construction** — Build the labeled susceptibility table using spatial crosswalks.
5. **Model Training** — Train and evaluate the temporal Transformer.
6. **Serving** — Expose predictions, a GeoJSON heatmap feed, and field reports through the FastAPI backend.

---

## 📂 Repository Layout

```text
BhuRakshak/
├── data/
│   ├── raw/                     # Inventories, satellite batches, and weather cache
│   ├── processed/                # Aligned/labeled tables, demo subset, site coordinates
│   └── field_reports/             # Uploaded field-report media + log (gitignored)
├── src/
│   ├── data_collection/          # Inventory and Google Earth Engine exporters
│   ├── preprocessing/            # Alignment, labels, negative sites, windows
│   ├── models/                   # Dataset loader, Transformer, evaluation, inference
│   └── api/                      # FastAPI backend
│       ├── main.py                 # App entrypoint, CORS, startup loading
│       ├── config.py                # Paths & settings (env-overridable)
│       ├── schemas.py               # Request/response models
│       ├── services/                # Model, demo, coordinates, field-report, geojson, filtering, region
│       └── routers/                 # predict, demo, reports, health
├── scripts/
│   ├── build_demo_subset.py       # Extracts a small fixed site subset for fast demos
│   └── build_site_coordinates.py  # Builds the site_id -> lat/lon lookup for the heatmap
├── artifacts/                    # Local model checkpoints and reports (ignored by Git)
├── requirements.txt               # Project dependencies
└── web/                           # Dashboard frontend
```

---

## 🚀 Getting Started

### Prerequisites

Python **3.11+**. A virtual environment is recommended.

### Setup

```powershell
# Create and activate virtual environment
py -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install dependencies (includes FastAPI, uvicorn, pydantic-settings, python-multipart)
python -m pip install -r requirements.txt
```

---

## 🛠️ Data Preparation

The following commands use local files.
> 💡 **Tip:** The `--skip-weather` option prevents Open-Meteo API calls and relies solely on satellite features.

```powershell
$python = ".\.venv\Scripts\python.exe"

# 1. Merge datasets
& $python src/data_collection/merge_landslide_datasets.py

# 2. Align time series
& $python src/preprocessing/align_timeseries.py --skip-weather

# 3. Build spatial crosswalks
& $python src/preprocessing/build_label_crosswalk.py --max-distance-m 250

# 4. Generate training dataset
& $python src/preprocessing/build_training_dataset.py
```

### Generated Artifacts

- `data/processed/aligned_dataset.csv`
- `data/processed/label_crosswalk.csv`
- `data/processed/training_dataset.csv`

_Note: The event-window command is reserved for future early-warning data. Currently, it yields no positive event windows as available dated events predate the satellite time series._

---

## 🧠 Model Training

Training utilizes one trailing 30-day window per site and implements a site-wise split to prevent data leakage:

```powershell
& $python src/models/train_susceptibility_transformer.py `
  --input data/processed/training_dataset.csv `
  --epochs 10 `
  --batch-size 64
```

_Checkpoints and metadata are stored in `artifacts/`._

---

## 📊 Evaluation

```powershell
& $python src/models/evaluate_susceptibility_transformer.py `
  --input data/processed/training_dataset.csv `
  --checkpoint artifacts/susceptibility_transformer.pt
```

### 🏆 Current Performance Metrics

| Metric | Score |
| :--- | :--- |
| **ROC-AUC** | 0.7945 |
| **Precision** | 0.9376 |
| **Recall** | 0.6014 |
| **F1-score** | 0.7328 |
| **Balanced Accuracy** | 0.7012 |

---

## 🔮 Command-Line Inference

For a one-off local prediction without starting the API:

```powershell
& $python src/models/predict_susceptibility.py `
  --site-id "arunachal_pradesh_2652" `
  --input data/processed/training_dataset.csv `
  --checkpoint artifacts/susceptibility_transformer.pt
```

### 🚦 Risk Thresholds

- 🟢 **0.00 – 0.32** : Low
- 🟡 **0.33 – 0.66** : Medium
- 🔴 **0.67 – 1.00** : High

---

## 🛰️ Running the API

The backend serves predictions, a GeoJSON heatmap feed, and field reports.

```powershell
uvicorn src.api.main:app --reload --port 8000
```

Then visit **`http://127.0.0.1:8000/docs`** for interactive Swagger UI, or use the endpoints directly:

### Full-dataset prediction (backed by `training_dataset.csv`)

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/predict/{site_id}` | Susceptibility for one site |
| `POST` | `/predict/batch` | Susceptibility for several sites |
| `POST` | `/predict/by-risk/{risk_class}` | Filter given sites down to one risk class |
| `POST` | `/predict/geojson` | Same as `/batch`, shaped as GeoJSON for map layers |

### ⚡ Demo mode (fast, in-memory, small fixed site subset)

Build the subset once (edit the site list inside the script first):

```powershell
python scripts/build_demo_subset.py
```

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/demo/sites` | List the fixed demo site_ids |
| `GET` | `/demo/predict/{site_id}` | Instant prediction for a demo site |
| `POST` | `/demo/predict/batch` | Batch prediction over demo sites |
| `POST` | `/demo/predict/by-risk/{risk_class}` | Risk-filtered demo predictions |
| `GET` | `/demo/geojson` | GeoJSON for the whole demo subset, filterable via query params |

### 🗺️ Map coordinates

Build the `site_id → lat/lon` lookup once so the GeoJSON endpoints can place markers:

```powershell
python scripts/build_site_coordinates.py
```

### 🎛️ Dashboard filters

`/predict/batch`, `/predict/geojson`, `/demo/predict/batch`, and `/demo/geojson` all accept the same filter fields — bind these directly to your dashboard's controls:

| Field | Type | Effect |
| :--- | :--- | :--- |
| `min_probability` | `float` | Only sites at or above this probability |
| `risk_classes` | `["Low" \| "Medium" \| "High"]` | Only sites in these risk buckets |
| `regions` | `list[str]` | Only sites whose inferred NER state matches (heuristic — see note below) |
| `include_features` | `bool` | Include each site's most recent raw feature values (for a detail panel) |

Example (query params, for `GET /demo/geojson`):

```
/demo/geojson?risk_classes=High&risk_classes=Medium&min_probability=0.5&include_features=true
```

> ℹ️ `regions` is inferred from the `state-name_index` site_id naming scheme (e.g. `nagaland_5181` → `nagaland`). Sites using the `point_00001` naming scheme have no encoded state and will show `region: null` until a coordinate-based crosswalk exists.

### 📸 Field reports

Geo-tagged photo/video reports from the field app — no model involved.

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `POST` | `/reports` | Submit a report (multipart: `latitude`, `longitude`, `category`, `description`, `site_id`, `media`) |
| `GET` | `/reports` | List submitted reports, optionally filtered by `site_id` |
| `GET` | `/reports/{report_id}` | Fetch one report |

Uploaded media is served back at the `media_url` each report returns (e.g. `/media/reports/<id>.jpg`).

### ❤️ Health check

```
GET /health
```

Reports whether the model checkpoint loaded and lists the feature names it expects.

---

## 🧬 Model Features

The Transformer relies on the following key features:

- `ndvi` (Normalized Difference Vegetation Index)
- `ndmi` (Normalized Difference Moisture Index)
- `sar_vv` & `sar_vh` (Sentinel-1 SAR backscatter)
- Sensor observation-staleness features
- `lat` & `lon` (Spatial coordinates)

_Weather features are not included in the current trained checkpoint since the final alignment run utilized `--skip-weather`._

---

## 🗺️ Roadmap

- [x] AI/ML susceptibility engine (Transformer)
- [x] Prediction API (full dataset + fast demo mode)
- [x] GeoJSON heatmap feed with dashboard filters
- [x] Field reporting (geo-tagged photo/video)
- [x] Dashboard frontend (with continuous WebGL heatmap)
- [x] Background cache warming for seamless startup and high-availability endpoints
- [ ] Multilingual SMS/app early-warning alert generation
- [ ] Time-to-event early-warning model (pending dated event records overlapping the satellite window)
- [ ] Offline sync for low-network areas

---

## 📝 Git Workflow Notes

- **Ignore:** Large generated datasets, caches, downloaded catalogs, scratch files, model artifacts, and uploaded field-report media are tracked via `.gitignore`.
- **Commit:** Source code, configurations, and documentation.
- ⚠️ **Security:** **Never** commit credentials, environment files, or Earth Engine service-account keys.
