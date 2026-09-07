from fastapi import APIRouter, HTTPException

from src.api.schemas import (
    BatchSusceptibilityRequest,
    BatchSusceptibilityResponse,
    RiskClass,
    RiskFilterRequest,
    RiskFilterResponse,
    RiskFilterSite,
    SusceptibilityResponse,
)
from src.api.services.model_service import (
    ModelNotLoadedError,
    SiteNotFoundError,
    service,
)

router = APIRouter(prefix="/predict", tags=["predict"])


def _predict_many(
    site_ids: list[str],
) -> tuple[list[SusceptibilityResponse], dict[str, str]]:
    """Shared loop used by /batch and /by-risk. Raises 503 immediately if the
    model isn't loaded; collects per-site failures into `errors` instead of
    failing the whole request, since callers (dashboard heatmap/filter) still
    want the sites that do resolve.
    """
    results: list[SusceptibilityResponse] = []
    errors: dict[str, str] = {}

    for site_id in site_ids:
        try:
            probability, risk_class = service.predict(site_id)
        except ModelNotLoadedError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except SiteNotFoundError as exc:
            errors[site_id] = str(exc)
            continue
        results.append(
            SusceptibilityResponse(
                site_id=site_id,
                susceptibility_probability=round(probability, 6),
                risk_class=risk_class,
            )
        )

    return results, errors


@router.get("/{site_id}", response_model=SusceptibilityResponse)
def predict_site(site_id: str) -> SusceptibilityResponse:
    try:
        probability, risk_class = service.predict(site_id)
    except ModelNotLoadedError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SiteNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return SusceptibilityResponse(
        site_id=site_id,
        susceptibility_probability=round(probability, 6),
        risk_class=risk_class,
    )


@router.post("/batch", response_model=BatchSusceptibilityResponse)
def predict_batch(request: BatchSusceptibilityRequest) -> BatchSusceptibilityResponse:
    """Predict for several sites at once — for the dashboard's heatmap view.

    Individual site failures (e.g. not enough history yet) are collected in
    `errors` rather than failing the whole batch, since a heatmap should
    still render the sites that do resolve.
    """
    results, errors = _predict_many(request.site_ids)
    return BatchSusceptibilityResponse(results=results, errors=errors)


@router.post("/by-risk/{risk_class}", response_model=RiskFilterResponse)
def predict_by_risk(risk_class: RiskClass, request: RiskFilterRequest) -> RiskFilterResponse:
    """Predict for the given site_ids, keeping only the ones matching
    `risk_class` (Low / Medium / High) in the response.

    Useful for a dashboard filter like "show me all High-risk sites" out of
    a candidate list — the client supplies which sites to check (e.g. all
    sites currently on screen), this endpoint narrows it down to the ones in
    that risk bucket, each with its probability.
    """
    results, errors = _predict_many(request.site_ids)
    matching = [
        RiskFilterSite(
            site_id=r.site_id,
            susceptibility_probability=r.susceptibility_probability,
        )
        for r in results
        if r.risk_class == risk_class
    ]
    return RiskFilterResponse(risk_class=risk_class, sites=matching, errors=errors)