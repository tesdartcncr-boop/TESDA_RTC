from __future__ import annotations

from .time_utils import calculate_dtr_metrics, get_schedule_details, is_leave_code, normalize_time_token
from ..supabase_client import get_supabase_client

DEFAULT_SCHEDULE_TYPE = "A"
DEFAULT_LATE_THRESHOLD = "08:00"
VALID_SCHEDULE_TYPES = {"A", "B"}


def _format_minutes_as_time(total_minutes: int) -> str:
  hours = total_minutes // 60
  minutes = total_minutes % 60
  return f"{hours:02d}:{minutes:02d}"


def normalize_schedule_type(value: str | None) -> str | None:
  if value is None:
    return None

  token = value.strip().upper()
  if not token:
    return None

  if token not in VALID_SCHEDULE_TYPES:
    raise ValueError("Schedule type must be A or B.")

  return token


def normalize_late_threshold(value: str | None) -> str | None:
  if value is None:
    return None

  token = normalize_time_token(value)
  if token is None or is_leave_code(token):
    raise ValueError("Late threshold must be a valid time.")

  return token


def get_default_late_threshold(schedule_type: str | None = None) -> str:
  resolved_schedule_type = normalize_schedule_type(schedule_type) or DEFAULT_SCHEDULE_TYPE
  schedule_start_minutes, _, _, _ = get_schedule_details(resolved_schedule_type)
  return _format_minutes_as_time(schedule_start_minutes)


def fetch_schedule_override(date_value: str) -> dict | None:
  supabase = get_supabase_client()
  try:
    response = (
      supabase.table("schedule_settings")
      .select("date,schedule_type,late_threshold")
      .eq("date", date_value)
      .limit(1)
      .execute()
    )
  except Exception:
    return None

  if not response.data:
    return None

  return response.data[0]


def resolve_schedule_context(date_value: str, fallback_schedule_type: str | None = None) -> tuple[str, str | None]:
  override = fetch_schedule_override(date_value)
  if override:
    schedule_type = normalize_schedule_type(override.get("schedule_type")) or DEFAULT_SCHEDULE_TYPE
    late_threshold = normalize_late_threshold(override.get("late_threshold"))
    return schedule_type, late_threshold

  schedule_type = normalize_schedule_type(fallback_schedule_type) or DEFAULT_SCHEDULE_TYPE
  return schedule_type, None


def get_schedule_display_values(date_value: str, fallback_schedule_type: str | None = None) -> dict:
  override = fetch_schedule_override(date_value)
  if override:
    schedule_type = normalize_schedule_type(override.get("schedule_type")) or DEFAULT_SCHEDULE_TYPE
    late_threshold = normalize_late_threshold(override.get("late_threshold")) or get_default_late_threshold(schedule_type)
    return {
      "date": date_value,
      "schedule_type": schedule_type,
      "late_threshold": late_threshold,
      "has_override": True
    }

  schedule_type = normalize_schedule_type(fallback_schedule_type) or DEFAULT_SCHEDULE_TYPE
  return {
    "date": date_value,
    "schedule_type": schedule_type,
    "late_threshold": get_default_late_threshold(schedule_type),
    "has_override": False
  }


def upsert_schedule_setting(date_value: str, schedule_type: str | None, late_threshold: str) -> dict:
  current = fetch_schedule_override(date_value)
  resolved_schedule_type = normalize_schedule_type(schedule_type or (current or {}).get("schedule_type")) or DEFAULT_SCHEDULE_TYPE
  resolved_late_threshold = normalize_late_threshold(late_threshold) or get_default_late_threshold(resolved_schedule_type)

  supabase = get_supabase_client()
  values = {
    "date": date_value,
    "schedule_type": resolved_schedule_type,
    "late_threshold": resolved_late_threshold
  }
  response = supabase.table("schedule_settings").upsert(values, on_conflict="date").execute()

  if not response.data:
    raise ValueError("Failed to save schedule settings.")

  return response.data[0]


def recalculate_attendance_for_date(date_value: str, schedule_type: str, late_threshold: str | None) -> list[dict]:
  supabase = get_supabase_client()
  response = (
    supabase.table("attendance")
    .select("*")
    .eq("date", date_value)
    .execute()
  )

  attendance_rows = response.data or []
  updated_rows: list[dict] = []

  for row in attendance_rows:
    leave_type = (row.get("leave_type") or "").strip().upper() or None
    time_in_value = row.get("time_in")
    time_out_value = row.get("time_out")

    if not leave_type:
      normalized_time_in = normalize_time_token(time_in_value)
      normalized_time_out = normalize_time_token(time_out_value)
      if is_leave_code(normalized_time_in):
        leave_type = normalized_time_in
      elif is_leave_code(normalized_time_out):
        leave_type = normalized_time_out

    if leave_type:
      late_minutes = 0
      undertime_minutes = 0
      overtime_minutes = 0
      normalized_in = None
      normalized_out = None
    else:
      late_minutes, undertime_minutes, overtime_minutes, normalized_in, normalized_out = calculate_dtr_metrics(
        schedule_type,
        time_in_value,
        time_out_value,
        None,
        late_threshold
      )

    values = {
      "schedule_type": schedule_type,
      "time_in": normalized_in,
      "time_out": normalized_out,
      "late_minutes": late_minutes,
      "undertime_minutes": undertime_minutes,
      "overtime_minutes": overtime_minutes,
      "leave_type": leave_type
    }

    result = supabase.table("attendance").update(values).eq("id", row["id"]).execute()
    if result.data:
      updated_rows.extend(result.data)

  return updated_rows