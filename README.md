# 🌍 BhuRakshak

> **Landslide Susceptibility System for Northeast India**

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Google Earth Engine](https://img.shields.io/badge/Earth_Engine-Supported-orange.svg)](https://earthengine.google.com/)

BhuRakshak is an advanced landslide susceptibility system tailored for Northeast India. It synergizes **Sentinel-1 SAR**, **Sentinel-2 optical indicators**, and historical **landslide inventory labels** with a temporal **Transformer model** to evaluate landslide risks based on recent satellite observations.

---

## 🎯 Current Scope

The current trained model predicts **landslide susceptibility**:

> _"How likely is this location to be historically landslide-prone based on its recent 30-day satellite sequence?"_

⚠️ **Note:** It does not predict whether a landslide will happen in the next few hours (early-warning). That task requires dated event records overlapping the satellite observation period and will be added as a separate training workflow when the required schema is available.

---

## ⚙️ Pipeline Overview

1. **Data Aggregation:** Collect and merge multiple landslide inventories.
2. **Satellite Export:** Export Sentinel-1 and Sentinel-2 time series via Google Earth Engine.
3. **Temporal Alignment:** Align satellite observations to a daily grid and engineer observation-staleness features.
4. **Dataset Construction:** Build the labeled susceptibility table using spatial crosswalks.
5. **Model Training:** Train and evaluate the temporal Transformer.
6. **Inference:** Run local site-level susceptibility predictions.

---

## 📂 Repository Layout

```text
BhuRakshak/
├── data/
│   ├── raw/                 # Inventories, satellite batches, and weather cache
│   └── processed/           # Generated aligned and labeled tables
├── src/
│   ├── data_collection/     # Inventory and Google Earth Engine exporters
│   ├── preprocessing/       # Alignment, labels, negative sites, windows
│   ├── models/              # Dataset loader, Transformer, evaluation, inference
│   └── api/                 # Reserved for the prediction API
├── artifacts/               # Local model checkpoints and reports (ignored by Git)
├── requirements.txt         # Project dependencies
└── web/                     # Reserved for the dashboard
```

---

## 🚀 Getting Started

### Prerequisites

Ensure you have **Python 3.11 or newer** installed. It's recommended to use a virtual environment.

### Setup

```powershell
# Create and activate virtual environment
py -m venv .venv
.\.venv\Scripts\Activate.ps1

# Install dependencies
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
_Checkpoints and metadata are safely stored in `artifacts/`._

---

## 📊 Evaluation

To evaluate model performance on the hold-out set:

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
| **Balanced Accuracy**| 0.7012 |

---

## 🔮 Inference

Run predictions for a specific site. The inference command processes the latest 30-day window and returns a probability alongside a risk class.

```powershell
& $python src/models/predict_susceptibility.py `
  --site-id "arunachal pradesh_2652" `
  --input data/processed/training_dataset.csv `
  --checkpoint artifacts/susceptibility_transformer.pt
```

### 🚦 Risk Thresholds

- 🟢 **0.00 - 0.32** : Low
- 🟡 **0.33 - 0.66** : Medium
- 🔴 **0.67 - 1.00** : High

---

## 🧬 Model Features

The Transformer relies on the following key features:

* `ndvi` (Normalized Difference Vegetation Index)
* `ndmi` (Normalized Difference Moisture Index)
* `sar_vv` & `sar_vh` (Sentinel-1 SAR backscatter)
* Sensor observation-staleness features
* `lat` & `lon` (Spatial coordinates)

_Weather features are not included in the current trained checkpoint since the final alignment run utilized `--skip-weather`._

---

## 📝 Git Workflow Notes

* **Ignore:** Large generated datasets, caches, downloaded catalogs, scratch files, and model artifacts are tracked via `.gitignore`.
* **Commit:** Source code, configurations, and documentation.
* ⚠️ **Security:** **Never** commit credentials, environment files, or Earth Engine service-account keys.
