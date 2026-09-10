"""Stores field reports (geo-tagged photo/video + metadata) submitted from
the mobile/web app. Prototype-grade storage: media files on disk, one JSON
line per report appended to a log file, and an in-memory list for fast
GET /reports. Swap for real object storage + a DB post-hackathon — the
router/service split makes that a contained change later.
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import UploadFile

from src.api.schemas import FieldReport, ReportCategory

ALLOWED_CONTENT_PREFIXES = ("image/", "video/")


class UnsupportedMediaTypeError(ValueError):
    """Raised when the uploaded file isn't an image or video."""


class FileTooLargeError(ValueError):
    """Raised when the uploaded file exceeds the configured size limit."""


class FieldReportService:
    def __init__(self) -> None:
        self._media_dir: Path | None = None
        self._log_path: Path | None = None
        self._max_bytes: int = 0
        self._reports: list[FieldReport] = []

    def load(self, media_dir: Path, log_path: Path, max_bytes: int) -> None:
        """Call once at API startup: ensures storage dirs exist and loads any
        previously logged reports into memory.
        """
        self._media_dir = media_dir
        self._log_path = log_path
        self._max_bytes = max_bytes

        media_dir.mkdir(parents=True, exist_ok=True)
        log_path.parent.mkdir(parents=True, exist_ok=True)

        reports: list[FieldReport] = []
        if log_path.exists():
            with log_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        reports.append(FieldReport.model_validate_json(line))
        self._reports = reports

    async def save(
        self,
        *,
        media: UploadFile,
        latitude: float,
        longitude: float,
        category: ReportCategory,
        description: str | None,
        site_id: str | None,
    ) -> FieldReport:
        if self._media_dir is None or self._log_path is None:
            raise RuntimeError("FieldReportService.load() was not called at startup.")

        content_type = media.content_type or "application/octet-stream"
        if not content_type.startswith(ALLOWED_CONTENT_PREFIXES):
            raise UnsupportedMediaTypeError(
                f"Unsupported content type '{content_type}' — only images and "
                "videos are accepted."
            )

        body = await media.read()
        if len(body) > self._max_bytes:
            raise FileTooLargeError(
                f"File is {len(body)} bytes, exceeds the "
                f"{self._max_bytes}-byte limit."
            )

        report_id = uuid.uuid4().hex
        suffix = Path(media.filename or "").suffix
        stored_filename = f"{report_id}{suffix}"
        (self._media_dir / stored_filename).write_bytes(body)

        report = FieldReport(
            report_id=report_id,
            submitted_at=datetime.now(timezone.utc).isoformat(),
            latitude=latitude,
            longitude=longitude,
            site_id=site_id,
            category=category,
            description=description,
            media_filename=stored_filename,
            media_content_type=content_type,
            media_url=f"/media/reports/{stored_filename}",
        )

        with self._log_path.open("a", encoding="utf-8") as f:
            f.write(report.model_dump_json() + "\n")

        self._reports.append(report)
        return report

    def list_reports(self, site_id: str | None = None) -> list[FieldReport]:
        if site_id is None:
            return list(self._reports)
        return [r for r in self._reports if r.site_id == site_id]

    def get(self, report_id: str) -> FieldReport | None:
        for r in self._reports:
            if r.report_id == report_id:
                return r
        return None


# Singleton, loaded once in main.py's startup hook.
field_report_service = FieldReportService()