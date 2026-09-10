"""Infers a NER state/region label from a site_id, for dashboard region
filtering. This is a heuristic, not ground truth: your satellite-CSV site_id
scheme is "state-name_index" (e.g. "arunachal_pradesh_0050"), but the
master/positive-site scheme is "point_00001" with no state encoded (per
your data notes — the two ID schemes don't correspond 1:1 without a
coordinate-based crosswalk). Sites using the point_ scheme will infer as
None/"unknown" here until a real site -> region lookup exists.
"""

_KNOWN_NER_STATES = (
    "arunachal_pradesh",
    "assam",
    "manipur",
    "meghalaya",
    "mizoram",
    "nagaland",
    "sikkim",
    "tripura",
)


def infer_region(site_id: str) -> str | None:
    lowered = site_id.lower()
    for state in _KNOWN_NER_STATES:
        if lowered.startswith(state):
            return state
    return None