"""Request/response models for the BhuRakshak API."""

from typing import Literal

from pydantic import BaseModel, Field

RiskClass = Literal["Low", "Medium", "High"]


class SusceptibilityResponse(BaseModel):
    site_id: str
    susceptibility_probability: float = Field(..., ge=0.0, le=1.0)
    risk_class: RiskClass
    region: str | None = None  # heuristic, see services/region.py
    feature_snapshot: dict[str, float] | None = None  # most recent day's raw values, only when requested


class DashboardFilterFields(BaseModel):
    """Shared optional filters — mix into any request that returns a list of
    sites, so a dashboard's filter dropdowns (risk class, region,
    probability threshold) and its "show details" toggle can bind straight
    to these fields.
    """

    min_probability: float | None = Field(
        None, ge=0.0, le=1.0, description="Only include sites at or above this probability."
    )
    risk_classes: list[RiskClass] | None = Field(
        None, description="Only include sites whose risk_class is in this list."
    )
    regions: list[str] | None = Field(
        None, description="Only include sites whose inferred region is in this list."
    )
    include_features: bool = Field(
        False, description="If true, include each site's most recent raw feature snapshot."
    )


class BatchSusceptibilityRequest(DashboardFilterFields):
    site_ids: list[str] = Field(..., min_length=1, max_length=500)


class BatchSusceptibilityResponse(BaseModel):
    results: list[SusceptibilityResponse]
    errors: dict[str, str] = Field(default_factory=dict)  # site_id -> error message


class RiskFilterRequest(DashboardFilterFields):
    """Site IDs to check, filtered down to a single risk class in the response."""

    site_ids: list[str] = Field(..., min_length=1, max_length=500)


class RiskFilterSite(BaseModel):
    site_id: str
    susceptibility_probability: float = Field(..., ge=0.0, le=1.0)
    region: str | None = None
    feature_snapshot: dict[str, float] | None = None


class RiskFilterResponse(BaseModel):
    risk_class: RiskClass
    sites: list[RiskFilterSite]
    errors: dict[str, str] = Field(default_factory=dict)  # site_id -> error message


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    features: list[str] | None = None


class DemoSiteListResponse(BaseModel):
    site_ids: list[str]


class GeoJSONPointGeometry(BaseModel):
    type: Literal["Point"] = "Point"
    coordinates: list[float]  # [longitude, latitude], per GeoJSON spec


class GeoJSONProperties(BaseModel):
    site_id: str
    susceptibility_probability: float = Field(..., ge=0.0, le=1.0)
    risk_class: RiskClass
    region: str | None = None
    feature_snapshot: dict[str, float] | None = None


class GeoJSONFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: GeoJSONPointGeometry
    properties: GeoJSONProperties


class GeoJSONFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[GeoJSONFeature]
    errors: dict[str, str] = Field(default_factory=dict)  # site_id -> error message


ReportCategory = Literal["crack", "slope_movement", "blocked_road", "other"]


class FieldReport(BaseModel):
    report_id: str
    submitted_at: str  # ISO 8601 UTC timestamp
    latitude: float
    longitude: float
    site_id: str | None = None
    category: ReportCategory
    description: str | None = None
    media_filename: str
    media_content_type: str
    media_url: str  # path the dashboard can fetch the file from


class FieldReportListResponse(BaseModel):
    reports: list[FieldReport]