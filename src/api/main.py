"""BhuRakshak prediction API.

Run from the repo root:
    uvicorn src.api.main:app --reload --port 8000

Then check:
    GET  http://127.0.0.1:8000/health
    GET  http://127.0.0.1:8000/predict/{site_id}
    POST http://127.0.0.1:8000/predict/batch   {"site_ids": ["..."]}
    GET  http://127.0.0.1:8000/docs            (interactive Swagger UI)
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.config import settings
from src.api.routers import health, predict
from src.api.services.model_service import service


@asynccontextmanager
async def lifespan(app: FastAPI):
    service.load()  # no-op (logs nothing, just skips) if checkpoint is missing
    yield


app = FastAPI(
    title="BhuRakshak API",
    description="Landslide susceptibility prediction for SIH26001 (NER).",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(predict.router)
