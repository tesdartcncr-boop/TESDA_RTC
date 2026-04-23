from datetime import date as Date, timedelta

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..schemas import AttendanceUpdate, ClockRequest, MasterSheetAttendanceUpsert
from ..services.cache_revision import invalidate_cache_revision
from ..services.schedule_settings import calculate_attendance_snapshot, resolve_schedule_context
from ..services.report_service import export_master_sheet_xlsx
from ..services.realtime import publish_event
from ..services.passwords import verify_employee_password
from ..services.time_utils import calculate_dtr_metrics, is_leave_code, now_app_date, now_military_time, normalize_time_token
from ..services.response_cache import get_cached_value, invalidate_cached_values, set_cached_value
from ..supabase_client import get_supabase_client

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
    snapshot = {}
    date_value = str(row.get("date") or "")
    if date_value:
      try:
        snapshot = calculate_attendance_snapshot(
          date_value,
          employee.get("category"),
          row.get("schedule_type"),
          row.get("time_in"),
          row.get("time_out"),
          row.get("leave_type")
        )
      except Exception:
        snapshot = {}

    enriched.append(
      {
        **row,
        **snapshot,
        "employee_name": employee.get("name", "Unknown Employee"),
        "category": employee.get("category", "unknown")
      }
    )
  return sorted(enriched, key=lambda item: item.get("employee_name", ""))


def _parse_sheet_date(value: str) -> Date:
  try:
    return Date.fromisoformat(value)
  except ValueError as error:
    raise HTTPException(status_code=400, detail="Dates must use YYYY-MM-DD format.") from error


def _category_sheet_label(category: str) -> str:
  if category == "regular":
    return "Regular"
  if category == "jo":
    return "JO"
  if category == "all":
    return "All Employees"
  return category.strip().title() or "Master"


def _format_sheet_title(start_date: Date, end_date: Date, category: str) -> str:
  category_label = _category_sheet_label(category)

  if start_date == end_date:
    return f"{category_label} Master Sheet - {start_date.strftime('%B')} {start_date.day}, {start_date.year}"

  if start_date.year == end_date.year and start_date.month == end_date.month:
    return f"{category_label} Master Sheet - {start_date.strftime('%B')} {start_date.day}-{end_date.day}, {start_date.year}"

  return (
    f"{category_label} Master Sheet - {start_date.strftime('%B')} {start_date.day}, {start_date.year} - "
    f"{end_date.strftime('%B')} {end_date.day}, {end_date.year}"
  )


def _format_sheet_day(value: Date) -> dict:
  return {
    "date": value.isoformat(),
    "label": f"{value.day}-{value.strftime('%b')}",
    "weekday": value.strftime("%A"),
    "is_weekend": value.weekday() >= 5,
    "is_monday": value.weekday() == 0
  }


def _build_sheet_dates(start_date: Date, end_date: Date) -> list[dict]:
  current = start_date
  values: list[dict] = []

  while current <= end_date:
    values.append(_format_sheet_day(current))
    current += timedelta(days=1)

  return values


def _normalize_sheet_token(value: str | None) -> str | None:
  if value is None:
    return None

  token = value.strip()
  if not token:
    return None

  normalized = normalize_time_token(token)
  return normalized


def _extract_leave_code(row: dict | None) -> str | None:
  if not row:
    return None

  for key in ("leave_type", "time_in", "time_out"):
    value = row.get(key)
    if is_leave_code(value):
      return str(value).strip().upper()

  return None


def _is_open_leave_record(row: dict | None) -> bool:
  if not row:
    return False

  return bool(_extract_leave_code(row)) and not (row.get("time_out") or "").strip()


def _is_open_ob_record(row: dict | None) -> bool:
  if not row:
    return False

  return _extract_leave_code(row) == "OB" and not (row.get("time_out") or "").strip()


def _display_sheet_value(row: dict, field: str) -> str:
  leave_type = (row.get("leave_type") or "").strip().upper() or None
  value = row.get(field)

  if field == "time_in":
    if leave_type:
      return leave_type
    if is_leave_code(value):
      return value or ""

  if field == "time_out" and is_leave_code(value):
    return value or ""

  return value or ""


def _employee_master_sort_key(employee: dict) -> tuple[str, str, str, str, int]:
  surname = (employee.get("last_name") or employee.get("surname") or employee.get("name") or "").strip().casefold()
  first_name = (employee.get("first_name") or "").strip().casefold()
  second_name = (employee.get("second_name") or "").strip().casefold()
  extension = (employee.get("extension") or "").strip().casefold()
  employee_id = int(employee.get("id") or 0)

  return surname, first_name, second_name, extension, employee_id


def _build_master_sheet_context(date_from: str, date_to: str, category: str) -> dict:
  start_date = _parse_sheet_date(date_from)
  end_date = _parse_sheet_date(date_to)
  if start_date > end_date:
    raise HTTPException(status_code=400, detail="From date must be earlier than or equal to to date.")

  supabase = get_supabase_client()
  employee_query = supabase.table("employees").select("id,employee_no,office,first_name,second_name,last_name,extension,name,category")

  if category in {"regular", "jo"}:
    employee_query = employee_query.eq("category", category)

  employees = sorted(employee_query.execute().data or [], key=_employee_master_sort_key)
  employee_map = {employee["id"]: employee for employee in employees}
  date_rows = _build_sheet_dates(start_date, end_date)

  def _compose_display_name(employee: dict) -> str:
    parts = [
      employee.get("first_name"),
      employee.get("second_name"),
      employee.get("last_name"),
      employee.get("extension")
    ]
    full_name = " ".join(part.strip() for part in parts if isinstance(part, str) and part.strip())
    if full_name:
      return " ".join(full_name.split())
    return (employee.get("name") or "Unknown Employee").strip() or "Unknown Employee"

  records: list[dict] = []
  if employee_map:
    attendance_rows = (
      supabase.table("attendance")
      .select("*")
      .in_("employee_id", list(employee_map.keys()))
      .gte("date", start_date.isoformat())
      .lte("date", end_date.isoformat())
      .execute()
      .data
      or []
    )

    for row in attendance_rows:
      employee = employee_map.get(row["employee_id"], {})
      snapshot = {}
      try:
        snapshot = calculate_attendance_snapshot(
          row["date"],
          employee.get("category"),
          row.get("schedule_type"),
          row.get("time_in"),
          row.get("time_out"),
          row.get("leave_type")
        )
      except Exception:
        snapshot = {}

      records.append(
        {
          **row,
          **snapshot,
          "employee_name": employee.get("name", "Unknown Employee"),
          "display_name": _compose_display_name(employee),
          "category": employee.get("category", "unknown"),
          "surname": (employee.get("last_name") or employee.get("name") or "Unknown").strip(),
          "display_time_in": _display_sheet_value(row, "time_in"),
          "display_time_out": _display_sheet_value(row, "time_out")
        }
      )

  return {
    "title": _format_sheet_title(start_date, end_date, category),
    "category": category,
    "date_from": start_date.isoformat(),
    "date_to": end_date.isoformat(),
    "dates": date_rows,
    "employees": [
      {
        "id": employee["id"],
        "office": employee.get("office"),
        "first_name": employee.get("first_name", ""),
        "second_name": employee.get("second_name"),
        "last_name": employee.get("last_name", ""),
        "extension": employee.get("extension"),
        "name": employee.get("name", ""),
        "display_name": _compose_display_name(employee),
        "surname": (employee.get("last_name") or employee.get("name") or "Unknown").strip(),
        "category": employee.get("category", "unknown")
      }
      for employee in employees
    ],
    "records": sorted(records, key=lambda item: (item.get("date", ""), item.get("employee_name", "")))
  }


def _master_sheet_cache_key(date_from: str, date_to: str, category: str) -> str:
  normalized_category = (category or "all").strip().lower() or "all"
  return f"attendance:master-sheet:v5:{normalized_category}:{date_from}:{date_to}"


def _get_cached_master_sheet_context(date_from: str, date_to: str, category: str) -> dict:
  cache_key = _master_sheet_cache_key(date_from, date_to, category)
  cached_sheet = get_cached_value(cache_key)
  if cached_sheet is not None:
    return cached_sheet

  sheet_data = _build_master_sheet_context(date_from, date_to, category)
  set_cached_value(cache_key, sheet_data, ttl_seconds=300.0)
  return sheet_data


def _resolve_master_sheet_values(payload: MasterSheetAttendanceUpsert, current: dict | None = None) -> dict:
  fallback_schedule_type = payload.schedule_type or (current or {}).get("schedule_type") or "A"
  employee = _get_employee(payload.employee_id)

  try:
    schedule_context = resolve_schedule_context(payload.date.isoformat(), employee.get("category"), fallback_schedule_type)
  except ValueError as error:
    raise HTTPException(status_code=400, detail=str(error)) from error

  explicit_leave_type = (payload.leave_type or "").strip().upper() or None
  if explicit_leave_type and not is_leave_code(explicit_leave_type):
    raise HTTPException(status_code=400, detail="Leave type must be SL, VL, or OB.")

  raw_time_in_value = _normalize_sheet_token(payload.time_in)
  raw_time_out_value = _normalize_sheet_token(payload.time_out)
  time_in_value = raw_time_in_value
  time_out_value = raw_time_out_value

  inferred_leave_type = None
  if is_leave_code(time_in_value):
    inferred_leave_type = time_in_value
    time_in_value = None
  if is_leave_code(time_out_value):
    inferred_leave_type = inferred_leave_type or time_out_value
    time_out_value = None

  leave_type = explicit_leave_type or inferred_leave_type

  if leave_type == "OB":
    late_minutes, undertime_minutes, overtime_minutes, normalized_in, normalized_out = calculate_dtr_metrics(
      schedule_context,
      raw_time_in_value,
      raw_time_out_value,
      leave_type,
      schedule_context.get("late_threshold")
    )
  elif leave_type:
    late_minutes = 0
    undertime_minutes = 0
    overtime_minutes = 0
    normalized_in = time_in_value
    normalized_out = time_out_value
  else:
    late_minutes, undertime_minutes, overtime_minutes, normalized_in, normalized_out = calculate_dtr_metrics(
      schedule_context,
      time_in_value,
      time_out_value,
      None,
      schedule_context.get("late_threshold")
    )

  return {
    "schedule_type": schedule_context.get("schedule_type") or fallback_schedule_type,
    "leave_type": leave_type,
    "time_in": normalized_in,
    "time_out": normalized_out,
    "late_minutes": late_minutes,
    "undertime_minutes": undertime_minutes,
    "overtime_minutes": overtime_minutes
  }


@router.get("/daily")
def get_daily_attendance(date: str, category: str = "regular") -> list[dict]:
  cache_key = f"attendance:daily:v4:{category}:{date}"
  cached_rows = get_cached_value(cache_key)
  if cached_rows is not None:
    return cached_rows

  supabase = get_supabase_client()
  employee_query = supabase.table("employees").select("id,employee_no,office,name,category")
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

  rows = _enrich_rows(attendance, employee_map)
  set_cached_value(cache_key, rows)
  return rows


@router.get("/master")
def get_master_attendance(
  date: str | None = None,
  category: str = "all",
  employee: str = "",
  search: str = ""
) -> list[dict]:
  supabase = get_supabase_client()
  employee_query = supabase.table("employees").select("id,employee_no,office,name,category")

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


@router.get("/master-sheet")
def get_master_sheet(date_from: str, date_to: str, category: str = "all") -> dict:
  return _get_cached_master_sheet_context(date_from, date_to, category)


@router.get("/master-sheet/export")
def export_master_sheet(date_from: str, date_to: str, category: str = "all") -> StreamingResponse:
  sheet_data = _get_cached_master_sheet_context(date_from, date_to, category)
  content = export_master_sheet_xlsx(sheet_data)
  category_token = (sheet_data.get("category") or category or "all").strip().lower() or "all"
  if sheet_data["date_from"] == sheet_data["date_to"]:
    filename = f"{category_token}-master-sheet-{sheet_data['date_from']}.xlsx"
  else:
    filename = f"{category_token}-master-sheet-{sheet_data['date_from']}-to-{sheet_data['date_to']}.xlsx"

  return StreamingResponse(
    iter([content]),
    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    headers={"Content-Disposition": f"attachment; filename={filename}"}
  )


@router.put("/master-sheet")
async def upsert_master_sheet_record(payload: MasterSheetAttendanceUpsert) -> dict:
  supabase = get_supabase_client()
  employee = _get_employee(payload.employee_id)

  current_response = (
    supabase.table("attendance")
    .select("*")
    .eq("employee_id", payload.employee_id)
    .eq("date", payload.date.isoformat())
    .limit(1)
    .execute()
  )
  current = current_response.data[0] if current_response.data else None

  values = _resolve_master_sheet_values(payload, current)
  if current is None and not any([values["time_in"], values["time_out"], values["leave_type"]]):
    raise HTTPException(status_code=400, detail="Enter a time or leave before saving.")

  record_values = {
    "employee_id": payload.employee_id,
    "date": payload.date.isoformat(),
    **values
  }

  if current:
    response = supabase.table("attendance").update(record_values).eq("id", current["id"]).execute()
  else:
    response = supabase.table("attendance").insert(record_values).execute()

  if not response.data:
    raise HTTPException(status_code=500, detail="Failed to save attendance record.")

  row = response.data[0]
  await publish_event(
    "attendance.updated",
    f"Attendance edited for {employee['name']} ({payload.date.isoformat()})",
    row
  )
  invalidate_cache_revision()
  invalidate_cached_values()
  return {**row, "employee_name": employee["name"], "category": employee["category"]}


@router.post("/clock")
async def clock_attendance(payload: ClockRequest) -> dict:
  supabase = get_supabase_client()
  employee = _get_employee(payload.employee_id)
  if not employee.get("employee_password_hash"):
    raise HTTPException(status_code=400, detail="Employee password is not set.")

  if not verify_employee_password(payload.employee_password, employee.get("employee_password_hash")):
    raise HTTPException(status_code=401, detail="Invalid employee password.")

  target_date = payload.date.isoformat() if payload.date else now_app_date()
  fallback_schedule_type = (payload.schedule_type or "A").upper()
  leave_type = (payload.leave_type or "").strip().upper() or None

  if leave_type and not is_leave_code(leave_type):
    raise HTTPException(status_code=400, detail="Leave type must be SL, VL, or OB.")

  existing_response = (
    supabase.table("attendance")
    .select("*")
    .eq("employee_id", payload.employee_id)
    .eq("date", target_date)
    .limit(1)
    .execute()
  )
  existing = existing_response.data[0] if existing_response.data else None
  existing_leave_code = _extract_leave_code(existing)
  existing_open_ob = _is_open_ob_record(existing)
  requested_leave_type = leave_type or (existing_leave_code if existing_leave_code in {"SL", "VL"} else None)
  now_time = now_military_time()
  recorded_clock_time = now_time

  try:
    schedule_context = resolve_schedule_context(target_date, employee.get("category"), fallback_schedule_type)

    if leave_type == "OB":
      if existing and existing.get("time_in") and existing.get("time_out"):
        raise HTTPException(status_code=400, detail="Time In and Time Out already recorded for this date.")

      if existing_open_ob:
        late, undertime, overtime, normalized_in, normalized_out = calculate_dtr_metrics(
          schedule_context,
          "OB",
          "OB",
          "OB",
          schedule_context.get("late_threshold")
        )
        action = "Time Out"
      elif existing and existing.get("time_in") and not existing.get("time_out"):
        late, undertime, overtime, normalized_in, normalized_out = calculate_dtr_metrics(
          schedule_context,
          existing.get("time_in"),
          "OB",
          "OB",
          schedule_context.get("late_threshold")
        )
        action = "Time Out"
      else:
        late, undertime, overtime, normalized_in, normalized_out = calculate_dtr_metrics(
          schedule_context,
          "OB",
          None,
          "OB",
          schedule_context.get("late_threshold")
        )
        action = "Time In"

      values = {
        "employee_id": payload.employee_id,
        "date": target_date,
        "late_minutes": late,
        "undertime_minutes": undertime,
        "overtime_minutes": overtime,
        "leave_type": "OB",
        "schedule_type": schedule_context.get("schedule_type") or fallback_schedule_type,
        "time_in": normalized_in,
        "time_out": normalized_out,
      }

      if existing:
        result = supabase.table("attendance").update(values).eq("id", existing["id"]).execute()
      else:
        result = supabase.table("attendance").insert(values).execute()

      row = result.data[0]
      await publish_event(
        "attendance.updated",
        f"{employee['name']} recorded OB {action} on {target_date}",
        row
      )
      invalidate_cache_revision()
      invalidate_cached_values()
      return {**row, "employee_name": employee["name"], "category": employee["category"]}

    if existing_open_ob and not leave_type:
      if existing and existing.get("time_in") and existing.get("time_out"):
        raise HTTPException(status_code=400, detail="Time In and Time Out already recorded for this date.")

      late, undertime, overtime, normalized_in, normalized_out = calculate_dtr_metrics(
        schedule_context,
        "OB",
        recorded_clock_time,
        "OB",
        schedule_context.get("late_threshold")
      )

      values = {
        "time_in": normalized_in,
        "time_out": normalized_out,
        "late_minutes": late,
        "undertime_minutes": undertime,
        "overtime_minutes": overtime,
        "schedule_type": schedule_context.get("schedule_type") or fallback_schedule_type,
        "leave_type": "OB"
      }

      result = supabase.table("attendance").update(values).eq("id", existing["id"]).execute()
      row = result.data[0]
      await publish_event(
        "attendance.updated",
        f"{employee['name']} recorded OB Time Out on {target_date}",
        row
      )
      invalidate_cache_revision()
      invalidate_cached_values()
      return {**row, "employee_name": employee["name"], "category": employee["category"]}

    if requested_leave_type:
      values = {
        "employee_id": payload.employee_id,
        "date": target_date,
        "late_minutes": 0,
        "undertime_minutes": 0,
        "overtime_minutes": 0,
        "leave_type": requested_leave_type,
        "schedule_type": schedule_context.get("schedule_type") or fallback_schedule_type
      }

      if existing and existing.get("time_in") and existing.get("time_out"):
        raise HTTPException(status_code=400, detail="Time In and Time Out already recorded for this date.")

      if _is_open_leave_record(existing):
        values["time_in"] = requested_leave_type
        values["time_out"] = requested_leave_type
      else:
        values["time_in"] = requested_leave_type
        values["time_out"] = None

      if existing:
        result = supabase.table("attendance").update(values).eq("id", existing["id"]).execute()
      else:
        result = supabase.table("attendance").insert(values).execute()

      row = result.data[0]
      action = "Time Out" if _is_open_leave_record(existing) else "Time In"
      await publish_event(
        "attendance.updated",
        f"{employee['name']} recorded {requested_leave_type} leave on {target_date}",
        row
      )
      invalidate_cache_revision()
      invalidate_cached_values()
      return {**row, "employee_name": employee["name"], "category": employee["category"]}

    # A completed record for the same day should not be clocked again.
    if existing and existing.get("time_in") and existing.get("time_out"):
      raise HTTPException(status_code=400, detail="Time In and Time Out already recorded for this date.")

    # Second tap records Time Out if Time In already exists.
    if existing and existing.get("time_in") and not existing.get("time_out") and not is_leave_code(existing.get("time_in")):
      late, undertime, overtime, normalized_in, normalized_out = calculate_dtr_metrics(
        schedule_context,
        existing.get("time_in"),
        recorded_clock_time,
        None,
        schedule_context.get("late_threshold")
      )

      values = {
        "time_in": normalized_in,
        "time_out": normalized_out,
        "late_minutes": late,
        "undertime_minutes": undertime,
        "overtime_minutes": overtime,
        "schedule_type": schedule_context.get("schedule_type") or fallback_schedule_type,
        "leave_type": existing.get("leave_type")
      }

      result = supabase.table("attendance").update(values).eq("id", existing["id"]).execute()
      row = result.data[0]
      action = "Time Out"
    else:
      # First tap records Time In and keeps Time Out empty.
      late, undertime, overtime, normalized_in, normalized_out = calculate_dtr_metrics(
        schedule_context,
        recorded_clock_time,
        None,
        None,
        schedule_context.get("late_threshold")
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
        "schedule_type": schedule_context.get("schedule_type") or fallback_schedule_type
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

  invalidate_cache_revision()
  invalidate_cached_values()

  return {**row, "employee_name": employee["name"], "category": employee["category"]}


@router.put("/{attendance_id}")
async def update_attendance(attendance_id: int, payload: AttendanceUpdate) -> dict:
  supabase = get_supabase_client()
  current_response = supabase.table("attendance").select("*").eq("id", attendance_id).limit(1).execute()
  if not current_response.data:
    raise HTTPException(status_code=404, detail="Attendance record not found.")

  current = current_response.data[0]
  employee = _get_employee(current["employee_id"])

  target_date = (payload.date.isoformat() if payload.date else current.get("date"))
  fallback_schedule_type = (payload.schedule_type or current.get("schedule_type") or "A").upper()
  leave_type = (payload.leave_type if payload.leave_type is not None else current.get("leave_type"))
  leave_type = (leave_type or "").strip().upper() or None

  if leave_type and not is_leave_code(leave_type):
    raise HTTPException(status_code=400, detail="Leave type must be SL, VL, or OB.")

  time_in = payload.time_in if payload.time_in is not None else current.get("time_in")
  time_out = payload.time_out if payload.time_out is not None else current.get("time_out")

  time_in_value = (time_in or "").strip() or None
  time_out_value = (time_out or "").strip() or None

  try:
    schedule_context = resolve_schedule_context(target_date, employee.get("category"), fallback_schedule_type)

    if leave_type == "OB":
      late, undertime, overtime, normalized_in, normalized_out = calculate_dtr_metrics(
        schedule_context,
        time_in_value,
        time_out_value,
        leave_type,
        schedule_context.get("late_threshold")
      )
    elif leave_type and not time_in_value and not time_out_value:
      late = 0
      undertime = 0
      overtime = 0
      normalized_in = None
      normalized_out = None
    else:
      late, undertime, overtime, normalized_in, normalized_out = calculate_dtr_metrics(
        schedule_context,
        time_in_value,
        time_out_value,
        None,
        schedule_context.get("late_threshold")
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
    "schedule_type": schedule_context.get("schedule_type") or fallback_schedule_type
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
  invalidate_cache_revision()
  invalidate_cached_values()
  return {**row, "employee_name": employee["name"], "category": employee["category"]}
