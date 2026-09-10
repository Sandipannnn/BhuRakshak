"""Field reports: geo-tagged photo/video uploads of cracks, slope movement,
or blocked roads from the mobile/web app. No model involved here — this is
plain upload + storage + listing for the dashboard to review.
"""

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from src.api.schemas import FieldReport, FieldReportListResponse, ReportCategory
from src.api.services.field_report_service import (
    FileTooLargeError,
    UnsupportedMediaTypeError,
    field_report_service,
)

router = APIRouter(prefix="/reports", tags=["field-reports"])


@router.post("", response_model=FieldReport)
async def submit_field_report(
    latitude: float = Form(...),
    longitude: float = Form(...),
    category: ReportCategory = Form(...),
    description: str | None = Form(None),
    site_id: str | None = Form(None),
    media: UploadFile = File(...),
) -> FieldReport:
    try:
        return await field_report_service.save(
            media=media,
            latitude=latitude,
            longitude=longitude,
            category=category,
            description=description,
            site_id=site_id,
        )
    except UnsupportedMediaTypeError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except FileTooLargeError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc


@router.get("", response_model=FieldReportListResponse)
def list_field_reports(site_id: str | None = None) -> FieldReportListResponse:
    """List submitted reports, optionally filtered to one site_id — for the
    dashboard's report feed or a per-site detail view.
    """
    return FieldReportListResponse(reports=field_report_service.list_reports(site_id))


@router.get("/{report_id}", response_model=FieldReport)
def get_field_report(report_id: str) -> FieldReport:
    report = field_report_service.get(report_id)
    if report is None:
        raise HTTPException(status_code=404, detail=f"Report '{report_id}' not found.")
    return report