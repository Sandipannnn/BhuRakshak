"""Fast prediction endpoints for the live demo, backed by a small fixed
subset of sites loaded fully into memory (see services/demo_service.py and
scripts/build_demo_subset.py). Separate from /predict/* so the full-dataset
heatmap pipeline is untouched — this is purely for a responsive demo UI
where the user picks from a short dropdown of sites.
"""

from fastapi import APIRouter, HTTPException, Query

from src.api.schemas import (
    BatchSusceptibilityRequest,
    BatchSusceptibilityResponse,
    DemoSiteListResponse,
    GeoJSONFeatureCollection,
    RiskClass,
    RiskFilterRequest,
    RiskFilterResponse,
    RiskFilterSite,
    SusceptibilityResponse,
)
from src.api.services.demo_service import demo_service
from src.api.services.filtering import apply_filters
from src.api.services.geojson import build_feature_collection
from src.api.services.model_service import ModelNotLoadedError, SiteNotFoundError, service
from src.api.services.region import infer_region

router = APIRouter(prefix="/demo", tags=["demo"])


def _predict_one(site_id: str, include_features: bool = False) -> SusceptibilityResponse:
    window = demo_service.get_window(site_id)  # raises SiteNotFoundError
    probability, risk_class = service.infer_from_window(window)  # raises ModelNotLoadedError
    snapshot = service.latest_feature_snapshot(window) if include_features else None
    return SusceptibilityResponse(
        site_id=site_id,
        susceptibility_probability=round(probability, 6),
        risk_class=risk_class,
        region=infer_region(site_id),
        feature_snapshot=snapshot,
    )


def _predict_many(
    site_ids: list[str], include_features: bool = False
) -> tuple[list[SusceptibilityResponse], dict[str, str]]:
    results: list[SusceptibilityResponse] = []
    errors: dict[str, str] = {}
    for site_id in site_ids:
        try:
            results.append(_predict_one(site_id, include_features=include_features))
        except ModelNotLoadedError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except SiteNotFoundError as exc:
            errors[site_id] = str(exc)
    return results, errors


@router.get("/sites", response_model=DemoSiteListResponse)
def list_demo_sites() -> DemoSiteListResponse:
    """The fixed set of site_ids available for the demo — populate the
    frontend's site picker from this instead of hardcoding it.
    """
    return DemoSiteListResponse(site_ids=demo_service.site_ids)


@router.get("/predict/{site_id}", response_model=SusceptibilityResponse)
def predict_demo_site(
    site_id: str, include_features: bool = Query(False)
) -> SusceptibilityResponse:
    try:
        return _predict_one(site_id, include_features=include_features)
    except ModelNotLoadedError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SiteNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/predict/batch", response_model=BatchSusceptibilityResponse)
def predict_demo_batch(request: BatchSusceptibilityRequest) -> BatchSusceptibilityResponse:
    results, errors = _predict_many(request.site_ids, include_features=request.include_features)
    results = apply_filters(results, request.min_probability, request.risk_classes, request.regions)
    return BatchSusceptibilityResponse(results=results, errors=errors)


@router.post("/predict/by-risk/{risk_class}", response_model=RiskFilterResponse)
def predict_demo_by_risk(
    risk_class: RiskClass, request: RiskFilterRequest
) -> RiskFilterResponse:
    results, errors = _predict_many(request.site_ids, include_features=request.include_features)
    results = apply_filters(results, request.min_probability, [risk_class], request.regions)
    matching = [
        RiskFilterSite(
            site_id=r.site_id,
            susceptibility_probability=r.susceptibility_probability,
            region=r.region,
            feature_snapshot=r.feature_snapshot,
        )
        for r in results
    ]
    return RiskFilterResponse(risk_class=risk_class, sites=matching, errors=errors)


@router.post("/predict/geojson", response_model=GeoJSONFeatureCollection)
def predict_demo_geojson(request: BatchSusceptibilityRequest) -> GeoJSONFeatureCollection:
    results, errors = _predict_many(request.site_ids, include_features=request.include_features)
    results = apply_filters(results, request.min_probability, request.risk_classes, request.regions)
    return build_feature_collection(results, errors)


@router.get("/geojson", response_model=GeoJSONFeatureCollection)
def demo_geojson_all(
    min_probability: float | None = Query(None, ge=0.0, le=1.0),
    risk_classes: list[RiskClass] | None = Query(None),
    regions: list[str] | None = Query(None),
    include_features: bool = Query(False),
) -> GeoJSONFeatureCollection:
    """GeoJSON for the demo subset, filterable via query params — bind your
    dashboard's risk-class dropdown, region dropdown, and probability
    slider straight to these. No request body needed, e.g.:

        /demo/geojson?risk_classes=High&risk_classes=Medium&min_probability=0.5
    """
    results, errors = _predict_many(demo_service.site_ids, include_features=include_features)
    results = apply_filters(results, min_probability, risk_classes, regions)
    return build_feature_collection(results, errors)