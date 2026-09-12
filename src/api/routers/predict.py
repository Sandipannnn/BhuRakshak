from fastapi import APIRouter, HTTPException, Query

from src.api.schemas import (
    BatchSusceptibilityRequest,
    BatchSusceptibilityResponse,
    GeoJSONFeatureCollection,
    RiskClass,
    RiskFilterRequest,
    RiskFilterResponse,
    RiskFilterSite,
    SusceptibilityResponse,
)
from src.api.services.filtering import apply_filters
from src.api.services.geojson import build_feature_collection
from src.api.services.model_service import (
    ModelNotLoadedError,
    SiteNotFoundError,
    service,
)
from src.api.services.region import infer_region
from src.api.services.coordinates_service import coordinates_service


router = APIRouter(prefix="/predict", tags=["predict"])


def _predict_many(
    site_ids: list[str], include_features: bool = False
) -> tuple[list[SusceptibilityResponse], dict[str, str]]:
    """Shared loop used by /batch, /by-risk, and /geojson. Raises 503
    immediately if the model isn't loaded; collects per-site failures into
    `errors` instead of failing the whole request, since callers (dashboard
    heatmap/filter) still want the sites that do resolve.

    The fast path uses a one-pass window loader in the model service to avoid
    re-scanning the entire training dataset for every site in the same batch.
    """
    try:
        raw_results, errors = service.predict_many(
            site_ids, include_features=include_features
        )
    except ModelNotLoadedError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SiteNotFoundError as exc:
        # Keep the old private error shape stable for a missing site list.
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    results: list[SusceptibilityResponse] = []
    for item in raw_results:
        results.append(
            SusceptibilityResponse(
                site_id=item["site_id"],
                susceptibility_probability=item["susceptibility_probability"],
                risk_class=item["risk_class"],
                region=infer_region(item["site_id"]),
                feature_snapshot=item["feature_snapshot"],
            )
        )

    return results, errors


# Must be registered BEFORE /{site_id} — FastAPI matches routes in
# registration order, so a dynamic path segment declared first will
# swallow literal-looking paths like "sites" as if they were a site_id.
@router.get("/sites")
def list_sites() -> list[dict]:
    """All known real site_ids with coordinates, for the frontend to fetch
    once and filter client-side by map viewport before calling /batch or
    /geojson with just the visible subset.
    """
    return [
        {"site_id": site_id, "lat": lat, "lon": lon}
        for site_id, (lat, lon) in coordinates_service.all_items().items()
    ]


@router.get("/{site_id}", response_model=SusceptibilityResponse)
def predict_site(
    site_id: str, include_features: bool = Query(False)
) -> SusceptibilityResponse:
    try:
        probability, risk_class, snapshot = service.predict(
            site_id, include_features=include_features
        )
    except ModelNotLoadedError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except SiteNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return SusceptibilityResponse(
        site_id=site_id,
        susceptibility_probability=round(probability, 6),
        risk_class=risk_class,
        region=infer_region(site_id),
        feature_snapshot=snapshot,
    )


@router.post("/batch", response_model=BatchSusceptibilityResponse)
def predict_batch(request: BatchSusceptibilityRequest) -> BatchSusceptibilityResponse:
    """Predict for several sites at once — for the dashboard's heatmap view.

    Individual site failures (e.g. not enough history yet) are collected in
    `errors` rather than failing the whole batch, since a heatmap should
    still render the sites that do resolve. Optional min_probability /
    risk_classes / regions filters narrow the returned list; include_features
    adds each site's most recent raw feature values for a detail panel.
    """
    results, errors = _predict_many(request.site_ids, include_features=request.include_features)
    results = apply_filters(results, request.min_probability, request.risk_classes, request.regions)
    return BatchSusceptibilityResponse(results=results, errors=errors)


@router.post("/by-risk/{risk_class}", response_model=RiskFilterResponse)
def predict_by_risk(risk_class: RiskClass, request: RiskFilterRequest) -> RiskFilterResponse:
    """Predict for the given site_ids, keeping only the ones matching
    `risk_class` (Low / Medium / High) in the response.

    Useful for a dashboard filter like "show me all High-risk sites" out of
    a candidate list — the client supplies which sites to check (e.g. all
    sites currently on screen), this endpoint narrows it down to the ones in
    that risk bucket, each with its probability. min_probability/regions in
    the body narrow it further.
    """
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


@router.post("/geojson", response_model=GeoJSONFeatureCollection)
def predict_geojson(request: BatchSusceptibilityRequest) -> GeoJSONFeatureCollection:
    """Same predictions as /batch, shaped as a GeoJSON FeatureCollection for
    the web/ dashboard's map layer to consume directly (e.g. Leaflet/Mapbox
    GL's addSource/addLayer, or a GeoJSON-aware React map component).

    Sites with a prediction but no known coordinates land in `errors` rather
    than being silently dropped — run scripts/build_site_coordinates.py if
    that happens for sites you expect to have coordinates. Same filter/
    include_features fields as /batch apply here too.
    """
    results, errors = _predict_many(request.site_ids, include_features=request.include_features)
    results = apply_filters(results, request.min_probability, request.risk_classes, request.regions)
    return build_feature_collection(results, errors)