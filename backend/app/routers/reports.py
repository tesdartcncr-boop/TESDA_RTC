import io
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..services.report_service import (
  build_late_report,
  build_monthly_summary,
  build_overtime_report,
  export_csv,
  export_xlsx,
  get_enriched_attendance,
)

router = APIRouter(prefix="/reports", tags=["reports"])


def _validate_month(month: str) -> str:
  try:
    datetime.strptime(month, "%Y-%m")
    return month
  except ValueError as error:
    raise HTTPException(status_code=400, detail="Month must use YYYY-MM format.") from error


@router.get("/monthly-summary")
def monthly_summary(month: str = Query(..., min_length=7, max_length=7)) -> list[dict]:
  valid_month = _validate_month(month)
  rows = get_enriched_attendance(valid_month)
  return build_monthly_summary(rows)


@router.get("/late-report")
def late_report(month: str = Query(..., min_length=7, max_length=7)) -> list[dict]:
  valid_month = _validate_month(month)
  rows = get_enriched_attendance(valid_month)
  return build_late_report(rows)


@router.get("/overtime-report")
def overtime_report(month: str = Query(..., min_length=7, max_length=7)) -> list[dict]:
  valid_month = _validate_month(month)
  rows = get_enriched_attendance(valid_month)
  return build_overtime_report(rows)


@router.get("/export")
def export_attendance_report(
  format: str = Query("csv", pattern="^(csv|xlsx)$"),
  month: str | None = Query(default=None)
):
  rows = get_enriched_attendance(month if month else None)

  if format == "xlsx":
    content = export_xlsx(rows)
    media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    filename = f"dtr-report-{month or 'all'}.xlsx"
  else:
    content = export_csv(rows)
    media_type = "text/csv"
    filename = f"dtr-report-{month or 'all'}.csv"

  return StreamingResponse(
    io.BytesIO(content),
    media_type=media_type,
    headers={"Content-Disposition": f"attachment; filename={filename}"}
  )
