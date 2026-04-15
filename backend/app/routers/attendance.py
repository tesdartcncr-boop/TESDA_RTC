from datetime import date

from fastapi import APIRouter, HTTPException

from ..schemas import AttendanceUpdate, ClockRequest
from ..services.realtime import publish_event
from ..services.passwords import verify_employee_password
from ..services.time_utils import calculate_dtr_metrics, is_leave_code, now_military_time
from ..supabase_client import get_supabase_client
from .settings import get_late_threshold_for_date

router = APIRouter(prefix="/attendance", tags=["attendance"])


def _get_employee(employee_id: int) -> dict:
  supabase = get_supabase_client()
  response = supabase.table("employees").select("id,name,category,employee_password_hash").eq("id", employee_id).limit(1).execute()
  if not response.data:
    raise HTTPException(status_code=404, detail="Employee not found.")
  return response.data[0]


def _enrich_rows(rows: list[dict], employees: dict[int, dict]) -> list[dict]:
  enriched: list[dict] = []
  for row in rows:
    employee = employees.get(row["employee_id"], {})
    enriched.append(
      {
        **row,
        "employee_name": employee.get("name", "Unknown Employee"),
        "category": employee.get("category", "unknown")
      }
    )
  return sorted(enriched, key=lambda item: item.get("employee_name", ""))


@router.get("/daily")
def get_daily_attendance(date: str, category: str = "regular") -> list[dict]:
  employee_query = supabase.table("employees").select("id,name,category")
  if category in {"regular", "jo"}:
    employee_query = employee_query.eq("category", category)

  employees = employee_query.execute().data or []
  if not employees:
    return []

  employee_map = {employee["id"]: employee for employee in employees}
  employee_ids = list(employee_map.keys())

  attendance = (
    supabase.table("attendance")
    .select("*")
    .eq("date", date)
    .in_("employee_id", employee_ids)
    .execute()
    .data
    or []
  )

  return _enrich_rows(attendance, employee_map)


@router.get("/master")
def get_master_attendance(
  date: str | None = None,
  category: str = "all",
  employee: str = "",
  search: str = ""
) -> list[dict]:
  employee_query = supabase.table("employees").select("id,name,category")

  if category in {"regular", "jo"}:
    employee_query = employee_query.eq("category", category)

  if employee.strip():
    employee_query = employee_query.ilike("name", f"%{employee.strip()}%")

  employees = employee_query.execute().data or []
  if not employees:
    return []

  employee_map = {item["id"]: item for item in employees}
  attendance_query = supabase.table("attendance").select("*").in_("employee_id", list(employee_map.keys()))

  if date:
    attendance_query = attendance_query.eq("date", date)

  rows = attendance_query.execute().data or []
  enriched = _enrich_rows(rows, employee_map)

  if search.strip():
    key = search.strip().lower()
    filtered = []
    for row in enriched:
      haystack = " ".join(
        [
          str(row.get("date", "")),
          str(row.get("employee_name", "")),
          str(row.get("category", "")),
          str(row.get("time_in", "")),
          str(row.get("time_out", "")),
          str(row.get("leave_type", "")),
          str(row.get("schedule_type", ""))
        ]
      ).lower()
      if key in haystack:
        filtered.append(row)
    enriched = filtered

  return sorted(enriched, key=lambda item: item.get("date", ""), reverse=True)


@router.post("/clock")
async def clock_attendance(payload: ClockRequest) -> dict:
  employee = _get_employee(payload.employee_id)
  if not employee.get("employee_password_hash"):
    raise HTTPException(status_code=400, detail="Employee password is not set.")

  if not verify_employee_password(payload.employee_password, employee.get("employee_password_hash")):
    raise HTTPException(status_code=401, detail="Invalid employee password.")

  target_date = (payload.date or date.today()).isoformat()
  schedule_type = (payload.schedule_type or "A").upper()
  leave_type = (payload.leave_type or "").strip().upper() or None

  existing_response = (
    supabase.table("attendance")
    .select("*")
    .eq("employee_id", payload.employee_id)
    .eq("date", target_date)
    .limit(1)
    .execute()
  )
  existing = existing_response.data[0] if existing_response.data else None
  late_threshold = get_late_threshold_for_date(target_date)

  try:
    if leave_type:
      late, undertime, overtime, normalized_in, normalized_out = calculate_dtr_metrics(
        schedule_type,
        leave_type,
        leave_type,
        late_threshold,
        leave_type
      )

      values = {
        "employee_id": payload.employee_id,
        "date": target_date,
        "time_in": normalized_in,
        "time_out": normalized_out,
        "late_minutes": late,
        "undertime_minutes": undertime,
        "overtime_minutes": overtime,
        "leave_type": leave_type,
        "schedule_type": schedule_type
      }

      if existing:
        result = supabase.table("attendance").update(values).eq("id", existing["id"]).execute()
      else:
        result = supabase.table("attendance").insert(values).execute()

      row = result.data[0]
      await publish_event(
        "attendance.updated",
        f"{employee['name']} tagged with leave {leave_type} for {target_date}",
        row
      )
      return {**row, "employee_name": employee["name"], "category": employee["category"]}

    now_time = now_military_time()

    # A completed record for the same day should not be clocked again.
    if existing and existing.get("time_in") and existing.get("time_out"):
      raise HTTPException(status_code=400, detail="Time In and Time Out already recorded for this date.")

    # Second tap records Time Out if Time In already exists.
    if existing and existing.get("time_in") and not existing.get("time_out") and not is_leave_code(existing.get("time_in")):
      late, undertime, overtime, normalized_in, normalized_out = calculate_dtr_metrics(
        existing.get("schedule_type") or schedule_type,
        existing.get("time_in"),
        now_time,
        late_threshold,
        existing.get("leave_type")
      )

      values = {
        "time_in": normalized_in,
        "time_out": normalized_out,
        "late_minutes": late,
        "undertime_minutes": undertime,
        "overtime_minutes": overtime,
        "schedule_type": existing.get("schedule_type") or schedule_type,
        "leave_type": existing.get("leave_type")
      }

      result = supabase.table("attendance").update(values).eq("id", existing["id"]).execute()
      row = result.data[0]
      action = "Time Out"
    else:
      # First tap records Time In and keeps Time Out empty.
      late, undertime, overtime, normalized_in, normalized_out = calculate_dtr_metrics(
        schedule_type,
        now_time,
        None,
        late_threshold,
        None
      )
      values = {
        "employee_id": payload.employee_id,
        "date": target_date,
        "time_in": normalized_in,
        "time_out": normalized_out,
        "late_minutes": late,
        "undertime_minutes": undertime,
        "overtime_minutes": overtime,
        "leave_type": None,
        "schedule_type": schedule_type
      }

      if existing:
        result = supabase.table("attendance").update(values).eq("id", existing["id"]).execute()
      else:
        result = supabase.table("attendance").insert(values).execute()

      row = result.data[0]
      action = "Time In"

  except ValueError as error:
    raise HTTPException(status_code=400, detail=str(error)) from error

  await publish_event(
    "attendance.updated",
    f"{employee['name']} recorded {action} on {target_date} ({row.get('time_out') or row.get('time_in')})",
    row
  )

  return {**row, "employee_name": employee["name"], "category": employee["category"]}


@router.put("/{attendance_id}")
async def update_attendance(attendance_id: int, payload: AttendanceUpdate) -> dict:
  current_response = supabase.table("attendance").select("*").eq("id", attendance_id).limit(1).execute()
  if not current_response.data:
    raise HTTPException(status_code=404, detail="Attendance record not found.")

  current = current_response.data[0]
  employee = _get_employee(current["employee_id"])

  target_date = (payload.date.isoformat() if payload.date else current.get("date"))
  schedule_type = (payload.schedule_type or current.get("schedule_type") or "A").upper()
  leave_type = (payload.leave_type if payload.leave_type is not None else current.get("leave_type"))
  leave_type = (leave_type or "").strip().upper() or None

  time_in = payload.time_in if payload.time_in is not None else current.get("time_in")
  time_out = payload.time_out if payload.time_out is not None else current.get("time_out")

  if leave_type in {"SL", "VL", "OB"} and payload.time_in is None and payload.time_out is None:
    time_in = leave_type
    time_out = leave_type

  late_threshold = get_late_threshold_for_date(target_date)

  try:
    late, undertime, overtime, normalized_in, normalized_out = calculate_dtr_metrics(
      schedule_type,
      time_in,
      time_out,
      late_threshold,
      leave_type
    )
  except ValueError as error:
    raise HTTPException(status_code=400, detail=str(error)) from error

  values = {
    "date": target_date,
    "time_in": normalized_in,
    "time_out": normalized_out,
    "late_minutes": late,
    "undertime_minutes": undertime,
    "overtime_minutes": overtime,
    "leave_type": leave_type,
    "schedule_type": schedule_type
  }

  response = supabase.table("attendance").update(values).eq("id", attendance_id).execute()
  if not response.data:
    raise HTTPException(status_code=500, detail="Failed to update attendance.")

  row = response.data[0]
  await publish_event(
    "attendance.updated",
    f"Attendance edited for {employee['name']} ({target_date})",
    row
  )
  return {**row, "employee_name": employee["name"], "category": employee["category"]}
