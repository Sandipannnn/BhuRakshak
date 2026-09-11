"""Build a small demo subset from the full training dataset.

Extracts the last DAYS days of data for a fixed list of SITE_IDS and writes
it to a small CSV that the API's demo service loads fully into memory. Run
this once (and again whenever you change the site list) — it does NOT touch
data/processed/training_dataset.csv or the full-dataset prediction path
used by the heatmap.

Usage (from repo root):
    python scripts/build_demo_subset.py

Edit SITE_IDS below to whichever sites you want in the live demo dropdown.
"""
import os

import sys

from pathlib import Path

import pandas as pd

SOURCE_CSV = Path("data/processed/training_dataset.csv")
OUTPUT_CSV = Path("data/processed/demo_subset.csv")
DAYS = 730

# Fill in with real site_ids from your dataset — e.g. via:
#   python -c "import pandas as pd; print(pd.read_csv('data/processed/training_dataset.csv')['site_id'].unique()[:20])"
SITE_IDS: list[str] = [
    "arunachal pradesh_2652",
    "arunachal pradesh_2821",
    "arunachal pradesh_5703",
    "assam_5723",
    "assam_5776",
    "assam_6969",
    "manipur_3850",
    "manipur_4010",
    "meghalaya_5921",
    "meghalaya_6273",
    "meghalaya_6428",
    "mizoram_7589",
    "mizoram_8029",
    "mizoram_8992",
    "nagaland_3293",
    "nagaland_4783",
    "sikkim_0812",
    "sikkim_1582",
    "west bengal_0691",
    "west bengal_2429",
     "arunachal pradesh_5474",
    "negative_manipur_1067",
    "west bengal_1147",
    "meghalaya_6588",
    "manipur_4040",
    "negative_meghalaya_1455",
    "negative_west_bengal_0438",
    "sikkim_1851",
    "negative_sikkim_1639",
    "nagaland_4789",
    "negative_arunachal_pradesh_1216",
    "assam_6808",
    "tripura_8529",
    "negative_west_bengal_0356",
    "mizoram_8632",
    "negative_tripura_1898",
    "negative_tripura_1888",
    "tripura_8546",
    "mizoram_7655",
    "negative_manipur_0959",
    "negative_meghalaya_1548",
    "meghalaya_6716",
    "negative_sikkim_1621",
    "arunachal_pradesh_0001",
    "nagaland_5134",
    "arunachal_pradesh_0017",
    "negative_assam_1749",
    "negative_arunachal_pradesh_1217",
    "negative_mizoram_0281",
    "arunachal pradesh_2767",
    "negative_nagaland_0770",
    "negative_assam_1714",
    "sikkim_1644",
    "negative_mizoram_0334",
    "west bengal_1430",
    "negative_nagaland_0881",
    "assam_6786",
    "manipur_4185",
    
]


def main() -> None:
    if not SITE_IDS:
        raise SystemExit(
            "SITE_IDS is empty — edit scripts/build_demo_subset.py and add "
            "the site_ids you want available in the demo."
        )

    chunks: list[pd.DataFrame] = []
    for chunk in pd.read_csv(SOURCE_CSV, parse_dates=["date"], chunksize=250_000, low_memory=False):
        matching = chunk[chunk["site_id"].isin(SITE_IDS)]
        if not matching.empty:
            chunks.append(matching)

    if not chunks:
        raise SystemExit(f"None of {SITE_IDS} were found in {SOURCE_CSV}.")

    subset = pd.concat(chunks, ignore_index=True)
    found_ids = sorted(subset["site_id"].unique())
    missing = sorted(set(SITE_IDS) - set(found_ids))
    if missing:
        print(f"Warning: not found in source data, skipping: {missing}")

    # Keep only the trailing DAYS days per site.
    trimmed = []
    for site_id, group in subset.groupby("site_id"):
        group = group.sort_values("date")
        cutoff = group["date"].max() - pd.Timedelta(days=DAYS)
        trimmed.append(group[group["date"] >= cutoff])
    result = pd.concat(trimmed, ignore_index=True).sort_values(["site_id", "date"])

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(OUTPUT_CSV, index=False)
    print(f"Wrote {len(result)} rows across {len(found_ids)} sites to {OUTPUT_CSV}")
    print(f"Sites included: {found_ids}")


if __name__ == "__main__":
    main()