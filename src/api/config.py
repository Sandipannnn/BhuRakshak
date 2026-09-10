"""API configuration.

All paths are relative to the repo root and can be overridden with
environment variables so the API can be pointed at different checkpoints
or datasets without code changes (useful once real data replaces synthetic
data, or when running in a container).
"""

from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    checkpoint_path: Path = Path("artifacts/susceptibility_transformer.pt")
    training_dataset_path: Path = Path("data/processed/training_dataset.csv")
    window_size: int = 30
    # Small in-memory subset for live demos — see scripts/build_demo_subset.py.
    # Kept separate from training_dataset_path so the full heatmap/prediction
    # pipeline is unaffected by demo mode.
    demo_dataset_path: Path = Path("data/processed/demo_subset.csv")
    demo_window_size: int = 365
    # site_id -> lat/lon lookup, built once via scripts/build_site_coordinates.py.
    site_coordinates_path: Path = Path("data/processed/site_coordinates.csv")

    # Field reports: geo-tagged photo/video uploads from the field app.
    # Stored as plain files + a JSON-lines log for now (no DB) — fine for a
    # prototype's report volume; swap for real storage/DB post-hackathon.
    field_reports_media_dir: Path = Path("data/field_reports/media")
    field_reports_log_path: Path = Path("data/field_reports/reports.jsonl")
    field_reports_max_bytes: int = 25 * 1024 * 1024  # 25 MB per upload

    # CORS: the dashboard (web/) and any mobile client origins during dev.
    allowed_origins: list[str] = ["*"]

    class Config:
        env_prefix = "BHURAKSHAK_"


settings = Settings()
