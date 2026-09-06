"""Predict susceptibility for one site's latest 30-day feature window."""

import argparse
from pathlib import Path

import numpy as np
import torch

from susceptibility_dataset import load_latest_site_window
from train_susceptibility_transformer import SusceptibilityTransformer


def classify_risk(probability: float) -> str:
    if probability < 0.33:
        return "Low"
    if probability < 0.67:
        return "Medium"
    return "High"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--input", type=Path, default=Path("data/processed/training_dataset.csv"))
    parser.add_argument("--checkpoint", type=Path, default=Path("artifacts/susceptibility_transformer.pt"))
    args = parser.parse_args()

    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    features = checkpoint["features"]
    window = load_latest_site_window(args.input, args.site_id, features=features)
    mean = np.asarray(checkpoint["feature_mean"], dtype=np.float32)
    std = np.asarray(checkpoint["feature_std"], dtype=np.float32)
    window = (window - mean) / std

    model = SusceptibilityTransformer(len(features))
    model.load_state_dict(checkpoint["model"])
    model.eval()
    with torch.no_grad():
        probability = float(torch.sigmoid(model(torch.from_numpy(window[None]))).item())

    print({
        "site_id": args.site_id,
        "susceptibility_probability": round(probability, 6),
        "risk_class": classify_risk(probability),
    })


if __name__ == "__main__":
    main()