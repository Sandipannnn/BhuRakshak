from fastapi import APIRouter

from src.api.schemas import HealthResponse
from src.api.services.model_service import service

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        model_loaded=service.is_loaded,
        features=service.features,
    )
