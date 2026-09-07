"""Request/response models for the BhuRakshak API."""

from typing import Literal

from pydantic import BaseModel, Field

RiskClass = Literal["Low", "Medium", "High"]


class SusceptibilityResponse(BaseModel):
    site_id: str
    susceptibility_probability: float = Field(..., ge=0.0, le=1.0)
    risk_class: RiskClass


class BatchSusceptibilityRequest(BaseModel):
    site_ids: list[str] = Field(..., min_length=1, max_length=500)


class BatchSusceptibilityResponse(BaseModel):
    results: list[SusceptibilityResponse]
    errors: dict[str, str] = Field(default_factory=dict)  # site_id -> error message


class RiskFilterRequest(BaseModel):
    """Site IDs to check, filtered down to a single risk class in the response."""

    site_ids: list[str] = Field(..., min_length=1, max_length=500)


class RiskFilterSite(BaseModel):
    site_id: str
    susceptibility_probability: float = Field(..., ge=0.0, le=1.0)


class RiskFilterResponse(BaseModel):
    risk_class: RiskClass
    sites: list[RiskFilterSite]
    errors: dict[str, str] = Field(default_factory=dict)  # site_id -> error message


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    features: list[str] | None = None