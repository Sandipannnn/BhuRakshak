"""Infers a NER state/region label from a site_id, for dashboard region
filtering. This is a heuristic, not ground truth — the dataset actually
uses three site_id naming schemes that need to be normalized before
matching:
  - "state_name_index"            e.g. "arunachal_pradesh_0001"
  - "state name_index"            e.g. "arunachal pradesh_2652"  (space)
  - "negative_state_name_index"   e.g. "negative_arunachal_pradesh_1216"
Sites using an unrecognized scheme infer as None/"unknown" here until a
real site -> region lookup exists.
"""

_KNOWN_STATES = (
    "arunachal_pradesh",
    "assam",
    "manipur",
    "meghalaya",
    "mizoram",
    "nagaland",
    "sikkim",
    "tripura",
    "west_bengal",
)


def infer_region(site_id: str) -> str | None:
    lowered = site_id.lower().replace(" ", "_")
    if lowered.startswith("negative_"):
        lowered = lowered[len("negative_"):]
    for state in _KNOWN_STATES:
        if lowered.startswith(state):
            return state
    return None