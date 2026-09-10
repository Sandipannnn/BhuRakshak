"""BhuRakshak prediction API.

Run from the repo root:
    uvicorn src.api.main:app --reload --port 8000

Then check:
    GET  http://127.0.0.1:8000/health
    GET  http://127.0.0.1:8000/predict/{site_id}
    POST http://127.0.0.1:8000/predict/batch     {"site_ids": ["..."]}
    POST http://127.0.0.1:8000/predict/geojson    {"site_ids": ["..."]}
    GET  http://127.0.0.1:8000/docs              (interactive Swagger UI)

Demo mode — fast, in-memory predictions over a small fixed site subset
(build it once with scripts/build_demo_subset.py):
    GET  http://127.0.0.1:8000/demo/sites
    GET  http://127.0.0.1:8000/demo/predict/{site_id}
    POST http://127.0.0.1:8000/demo/predict/batch
    POST http://127.0.0.1:8000/demo/predict/by-risk/{risk_class}
    GET  http://127.0.0.1:8000/demo/geojson       (all demo sites at once)

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
from src.api.routers import alerts, demo, health, predict, reports
from src.api.services.coordinates_service import coordinates_service
from src.api.services.demo_service import demo_service
from src.api.services.field_report_service import field_report_service
from src.api.services.model_service import service


@asynccontextmanager
async def lifespan(app: FastAPI):
    service.load()  # no-op (logs nothing, just skips) if checkpoint is missing
    if service.is_loaded:
        # Demo subset reuses the same trained model/features — only load it
        # once the main model is ready.
        demo_service.load(
            settings.demo_dataset_path,
            features=service.features,
            window_size=settings.demo_window_size,
        )
    coordinates_service.load(settings.site_coordinates_path)
    field_report_service.load(
        settings.field_reports_media_dir,
        settings.field_reports_log_path,
        settings.field_reports_max_bytes,
    )
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
app.include_router(demo.router)
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