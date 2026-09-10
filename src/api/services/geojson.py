"""Turns a list of SusceptibilityResponse into a GeoJSON FeatureCollection,
using the in-memory coordinates_service lookup. Shared by the /predict and
/demo routers so the heatmap-facing shape is identical regardless of which
data path produced the predictions.
"""

from src.api.schemas import (
    GeoJSONFeature,
    GeoJSONFeatureCollection,
    GeoJSONPointGeometry,
    GeoJSONProperties,
    SusceptibilityResponse,
)
from src.api.services.coordinates_service import coordinates_service


def build_feature_collection(
    results: list[SusceptibilityResponse],
    errors: dict[str, str],
) -> GeoJSONFeatureCollection:
    features: list[GeoJSONFeature] = []
    combined_errors = dict(errors)

    for result in results:
        coords = coordinates_service.get(result.site_id)
        if coords is None:
            combined_errors[result.site_id] = (
                "No coordinates on file for this site — run "
                "scripts/build_site_coordinates.py to (re)build the lookup."
            )
            continue

        lat, lon = coords
        features.append(
            GeoJSONFeature(
                geometry=GeoJSONPointGeometry(coordinates=[lon, lat]),
                properties=GeoJSONProperties(
                    site_id=result.site_id,
                    susceptibility_probability=result.susceptibility_probability,
                    risk_class=result.risk_class,
                    region=result.region,
                    feature_snapshot=result.feature_snapshot,
                ),
            )
        )

    return GeoJSONFeatureCollection(features=features, errors=combined_errors)