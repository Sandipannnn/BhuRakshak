"""Evaluate the trained susceptibility Transformer on its held-out site split."""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import (
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

from susceptibility_dataset import load_site_windows
from train_susceptibility_transformer import SusceptibilityTransformer


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("data/processed/training_dataset.csv"))
    parser.add_argument("--checkpoint", type=Path, default=Path("artifacts/susceptibility_transformer.pt"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/susceptibility_evaluation.json"))
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    values, labels, features = load_site_windows(args.input, features=checkpoint["features"])
    if features != checkpoint["features"]:
        raise ValueError("Dataset feature order does not match the checkpoint.")

    np.random.seed(args.seed)
    order = np.random.permutation(len(labels))
    split = int(len(order) * 0.8)
    test_idx = order[split:]

    mean = np.asarray(checkpoint["feature_mean"], dtype=np.float32)
    std = np.asarray(checkpoint["feature_std"], dtype=np.float32)
    values = (values - mean) / std

    model = SusceptibilityTransformer(len(features))
    model.load_state_dict(checkpoint["model"])
    model.eval()
    with torch.no_grad():
        logits = model(torch.from_numpy(values[test_idx]))
        probabilities = torch.sigmoid(logits).numpy()

    truth = labels[test_idx].astype(np.int8)
    predicted = (probabilities >= 0.5).astype(np.int8)
    matrix = confusion_matrix(truth, predicted, labels=[0, 1])
    report = {
        "test_sites": int(len(test_idx)),
        "positive_sites": int(truth.sum()),
        "negative_sites": int(len(truth) - truth.sum()),
        "threshold": 0.5,
        "roc_auc": float(roc_auc_score(truth, probabilities)),
        "precision": float(precision_score(truth, predicted, zero_division=0)),
        "recall": float(recall_score(truth, predicted, zero_division=0)),
        "f1": float(f1_score(truth, predicted, zero_division=0)),
        "balanced_accuracy": float(balanced_accuracy_score(truth, predicted)),
        "confusion_matrix": {
            "labels": ["negative", "positive"],
            "values": matrix.tolist(),
        },
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    print(f"saved={args.output}")


if __name__ == "__main__":
    main()