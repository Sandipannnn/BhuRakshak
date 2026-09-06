"""Train a site-split temporal Transformer for landslide susceptibility."""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from susceptibility_dataset import load_site_windows


class SusceptibilityTransformer(nn.Module):
    def __init__(self, n_features: int, d_model: int = 64, n_heads: int = 4,
                 layers: int = 2, dropout: float = 0.1):
        super().__init__()
        self.projection = nn.Linear(n_features, d_model)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=n_heads, dropout=dropout,
            batch_first=True, norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=layers)
        self.head = nn.Sequential(nn.LayerNorm(d_model), nn.Linear(d_model, 1))

    def forward(self, values: torch.Tensor) -> torch.Tensor:
        encoded = self.encoder(self.projection(values))
        return self.head(encoded[:, -1]).squeeze(-1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("data/processed/training_dataset.csv"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/susceptibility_transformer.pt"))
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    values, labels, features = load_site_windows(args.input)
    order = np.random.permutation(len(labels))
    split = int(len(order) * 0.8)
    train_idx, test_idx = order[:split], order[split:]
    feature_mean = values[train_idx].reshape(-1, values.shape[-1]).mean(axis=0)
    feature_std = values[train_idx].reshape(-1, values.shape[-1]).std(axis=0)
    feature_std[feature_std < 1e-6] = 1.0
    values = (values - feature_mean) / feature_std
    train = TensorDataset(torch.from_numpy(values[train_idx]), torch.from_numpy(labels[train_idx]))
    test = TensorDataset(torch.from_numpy(values[test_idx]), torch.from_numpy(labels[test_idx]))
    loader = DataLoader(train, batch_size=args.batch_size, shuffle=True)

    model = SusceptibilityTransformer(values.shape[-1])
    positives = labels[train_idx].sum()
    negatives = len(train_idx) - positives
    criterion = nn.BCEWithLogitsLoss(pos_weight=torch.tensor([negatives / max(positives, 1)]))
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)

    for epoch in range(args.epochs):
        model.train()
        total = 0.0
        for batch_values, batch_labels in loader:
            optimizer.zero_grad()
            loss = criterion(model(batch_values), batch_labels)
            loss.backward()
            optimizer.step()
            total += loss.item() * len(batch_labels)
        print(f"epoch={epoch + 1} loss={total / len(train):.4f}")

    model.eval()
    with torch.no_grad():
        logits = model(torch.from_numpy(values[test_idx]))
        predictions = (torch.sigmoid(logits) >= 0.5).numpy()
    accuracy = float((predictions == labels[test_idx]).mean())
    print(f"test_accuracy={accuracy:.4f} test_sites={len(test_idx)}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "model": model.state_dict(),
        "features": features,
        "feature_mean": feature_mean.tolist(),
        "feature_std": feature_std.tolist(),
    }, args.output)
    args.output.with_suffix(".json").write_text(json.dumps({
        "features": features,
        "feature_mean": feature_mean.tolist(),
        "feature_std": feature_std.tolist(),
        "test_accuracy": accuracy,
    }, indent=2))
    print(f"saved={args.output}")


if __name__ == "__main__":
    main()