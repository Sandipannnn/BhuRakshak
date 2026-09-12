"""BhuRakshak prediction API.

Run from the repo root:
    uvicorn src.api.main:app --reload --port 8000

Then check:
    GET  http://127.0.0.1:8000/health
    GET  http://127.0.0.1:8000/predict/{site_id}
    POST http://127.0.0.1:8000/predict/batch     {"site_ids": ["..."]}
    POST http://127.0.0.1:8000/predict/geojson    {"site_ids": ["..."]}
    GET  http://127.0.0.1:8000/docs              (interactive Swagger UI)


Field reports — geo-tagged photo/video from the field app (no model):
    POST http://127.0.0.1:8000/reports            (multipart form: latitude,
                                                     longitude, category,
                                                     description, site_id, media)
    GET  http://127.0.0.1:8000/reports
    GET  http://127.0.0.1:8000/reports/{report_id}

Map coordinates (build once with scripts/build_site_coordinates.py):
    powers the geojson endpoints above; without it they return every site
    in `errors` instead of a feature.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from src.api.config import settings
from src.api.routers import alerts, health, predict, reports
from src.api.services.field_report_service import field_report_service
from src.api.services.model_service import service
from src.api.services.coordinates_service import coordinates_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    service.load()  # no-op (logs nothing, just skips) if checkpoint is missing
    coordinates_service.load(settings.site_coordinates_path)
    field_report_service.load(
        settings.field_reports_media_dir,
        settings.field_reports_log_path,
        settings.field_reports_max_bytes,
    )
    # Pre-warm the window cache in a background thread so the API is
    # responsive immediately (/health works) while the heavy 5.7 GB CSV
    # scan happens once in the background instead of on every request.
    if service.is_loaded and coordinates_service.is_loaded:
        all_site_ids = list(coordinates_service.all_items().keys())
        service.warm_cache_async(all_site_ids)
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
app.include_router(reports.router)
app.include_router(alerts.router)


# Serves uploaded field-report media at the media_url paths FieldReport
# returns (e.g. /media/reports/<id>.jpg). check_dir=False avoids a startup
# crash on first run before the directory has been created by the lifespan
# hook above — order of app construction runs before lifespan in FastAPI.
app.mount(
    "/media/reports",
    StaticFiles(directory=settings.field_reports_media_dir, check_dir=False),
    name="report-media",
)

# Serves the BhuRakshak web dashboard at root
app.mount(
    "/",
    StaticFiles(directory="web", html=True),
    name="dashboard",
)