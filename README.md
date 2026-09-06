# BhuRakshak

BhuRakshak is a landslide susceptibility system for Northeast India. It combines Sentinel-1 SAR, Sentinel-2 optical indicators, and landslide inventory labels with a temporal Transformer model.

## Current Scope

The current trained model predicts **landslide susceptibility**:

> How likely is this location to be historically landslide-prone based on its recent 30-day satellite sequence?

It does not predict whether a landslide will happen in the next few hours. That early-warning task requires dated event records that overlap the satellite observation period and will be added as a separate training workflow when the required schema is available.

## Pipeline

1. Collect and merge landslide inventories.
2. Export Sentinel-1 and Sentinel-2 time series through Google Earth Engine.
3. Align satellite observations to a daily grid and add observation-staleness features.
4. Build the labeled susceptibility table.
5. Train and evaluate the temporal Transformer.
6. Run local site-level susceptibility predictions.

## Repository Layout

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
├── requirements.txt
└── web/                     # Reserved for the dashboard
```

## Setup

Use Python 3.11 or newer in a virtual environment:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

## Data Preparation

The following commands use local files. The `--skip-weather` option prevents Open-Meteo API calls and uses satellite features only:

```powershell
$python = ".\.venv\Scripts\python.exe"

& $python src/data_collection/merge_landslide_datasets.py
& $python src/preprocessing/align_timeseries.py --skip-weather
& $python src/preprocessing/build_label_crosswalk.py --max-distance-m 250
& $python src/preprocessing/build_training_dataset.py
```

Generated files include:

```text
data/processed/aligned_dataset.csv
data/processed/label_crosswalk.csv
data/processed/training_dataset.csv
```

The event-window command is reserved for future dated-event early-warning data. With the current inventories it correctly produces no positive event windows because the available dated events predate the satellite time series.

## Train The Susceptibility Transformer

Training uses one trailing 30-day window per site and splits by site to avoid row-level leakage:

```powershell
& $python src/models/train_susceptibility_transformer.py `
  --input data/processed/training_dataset.csv `
  --epochs 10 `
  --batch-size 64
```

The checkpoint and metadata are written to `artifacts/`.

## Evaluate The Model

```powershell
& $python src/models/evaluate_susceptibility_transformer.py `
  --input data/processed/training_dataset.csv `
  --checkpoint artifacts/susceptibility_transformer.pt
```

Current evaluation results:

```text
ROC-AUC:           0.7945
Precision:         0.9376
Recall:            0.6014
F1-score:          0.7328
Balanced accuracy: 0.7012
```

## Run A Prediction

The inference command reads the latest 30-day window for one existing site and returns a probability and risk class:

```powershell
& $python src/models/predict_susceptibility.py `
  --site-id "arunachal pradesh_2652" `
  --input data/processed/training_dataset.csv `
  --checkpoint artifacts/susceptibility_transformer.pt
```

Risk thresholds are currently:

```text
0.00-0.32  Low
0.33-0.66  Medium
0.67-1.00  High
```

## Model Features

The Transformer uses:

- `ndvi`
- `ndmi`
- `sar_vv`
- `sar_vh`
- Sensor observation-staleness features
- `lat` and `lon`

Weather features are not included in the current trained checkpoint because the final alignment run used `--skip-weather`.

## Git Notes

Large generated datasets, caches, downloaded catalogs, scratch files, and model artifacts are ignored. Keep source code, configuration, and documentation in Git. Do not commit credentials or Earth Engine service-account keys.
