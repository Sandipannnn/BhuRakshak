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

    # CORS: the dashboard (web/) and any mobile client origins during dev.
    allowed_origins: list[str] = ["*"]

    class Config:
        env_prefix = "BHURAKSHAK_"


settings = Settings()
