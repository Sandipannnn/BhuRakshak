"""Post-prediction filters shared by /predict and /demo routers: narrows a
list of SusceptibilityResponse down by minimum probability, risk class, and
region — the building blocks for a dashboard's filter dropdowns.
"""

from src.api.schemas import RiskClass, SusceptibilityResponse


def apply_filters(
    results: list[SusceptibilityResponse],
    min_probability: float | None = None,
    risk_classes: list[RiskClass] | None = None,
    regions: list[str] | None = None,
) -> list[SusceptibilityResponse]:
    filtered = results

    if min_probability is not None:
        filtered = [r for r in filtered if r.susceptibility_probability >= min_probability]

    if risk_classes:
        allowed_risk = set(risk_classes)
        filtered = [r for r in filtered if r.risk_class in allowed_risk]

    if regions:
        allowed_regions = {r.lower() for r in regions}
        filtered = [r for r in filtered if (r.region or "").lower() in allowed_regions]

    return filtered