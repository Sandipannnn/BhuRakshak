import pandas as pd

from src.models.susceptibility_dataset import load_latest_site_windows


def test_load_latest_site_windows_groups_synthetic_rows(tmp_path):
    csv_path = tmp_path / "training_dataset.csv"

    rows = []
    feature_names = ["ndvi", "ndmi", "sar_vv", "sar_vh"]
    for site_id in ["alpha", "beta"]:
        for i in range(6):
            base = i * 0.1
            rows.append({
                "site_id": site_id,
                "date": f"2024-01-{i + 1:02d}",
                "ndvi": 0.1 + base,
                "ndmi": 0.2 + base,
                "sar_vv": 0.3 + base,
                "sar_vh": 0.4 + base,
            })

    pd.DataFrame(rows).to_csv(csv_path, index=False)

    windows = load_latest_site_windows(
        csv_path,
        site_ids=["alpha", "beta"],
        window_size=4,
        features=feature_names,
        chunksize=1,
    )

    assert set(windows) == {"alpha", "beta"}
    assert windows["alpha"].shape == (4, len(feature_names))
    assert windows["beta"].shape == (4, len(feature_names))
