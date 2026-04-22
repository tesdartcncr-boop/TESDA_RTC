from __future__ import annotations

from datetime import date as Date
from typing import Any

from .response_cache import get_cached_value, invalidate_cached_values, set_cached_value
from .time_utils import calculate_dtr_metrics, get_schedule_details, is_leave_code, normalize_time_token, to_minutes
from ..supabase_client import get_supabase_client

DEFAULT_SCHEDULE_TYPE = "A"
DEFAULT_LATE_THRESHOLD = "08:00"
DEFAULT_SCHEDULE_START = "08:00"
DEFAULT_SCHEDULE_END = "17:00"
DEFAULT_REQUIRED_MINUTES = 480
DEFAULT_WEEKLY_CATEGORY = "regular"
DEFAULT_REGULAR_EARLIEST_RECORD_TIME = "07:00"
DEFAULT_JO_EARLIEST_RECORD_TIME = "08:00"
VALID_SCHEDULE_TYPES = {"A", "B"}
VALID_WEEKLY_CATEGORIES = {"regular", "jo"}
CATEGORY_SCHEDULE_TYPES = {"regular": "A", "jo": "B"}
WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
REGULAR_PRESETS = {
  480: {
    "label": "8-hour",
    "required_minutes": 480,
    "late_threshold_monday": "08:01",
    "late_threshold_weekday": "10:01",
    "schedule_start": "08:00",
    "schedule_end": "17:00"
  },
  600: {
    "label": "10-hour",
    "required_minutes": 600,
    "late_threshold_monday": "08:01",
    "late_threshold_weekday": "09:01",
    "schedule_start": "08:00",
    "schedule_end": "19:00"
  }
}
JO_PRESETS = {
  480: {
    "label": "8-hour",
    "required_minutes": 480,
    "late_threshold_weekday": "08:01",
    "late_threshold_weekend": "09:01",
    "schedule_start": "08:00",
    "schedule_end": "17:00"
  },
  600: {
    "label": "10-hour",
    "required_minutes": 600,
    "late_threshold_weekday": "08:01",
    "late_threshold_weekend": "09:01",
    "schedule_start": "08:00",
    "schedule_end": "19:00"
  }
}
CATEGORY_EARLIEST_RECORD_TIME = {
  "regular": DEFAULT_REGULAR_EARLIEST_RECORD_TIME,
  "jo": DEFAULT_JO_EARLIEST_RECORD_TIME,
}
_CACHE_TTL_SECONDS = 30.0
_OPTIONAL_CACHE_MARKER = "__dtr_optional_cache__"


def _schedule_cache_key(*parts: str) -> str:
  return "schedule-settings:" + ":".join(parts)


def _set_schedule_cache(cache_key: str, value: Any, ttl_seconds: float = _CACHE_TTL_SECONDS) -> None:
  set_cached_value(cache_key, value, ttl_seconds)


def _read_optional_schedule_cache(cache_key: str) -> tuple[bool, Any | None]:
  cached_value = get_cached_value(cache_key)
  if cached_value is None:
    return False, None

  if isinstance(cached_value, dict) and cached_value.get(_OPTIONAL_CACHE_MARKER):
    return True, cached_value.get("value")

  return True, cached_value


def _write_optional_schedule_cache(cache_key: str, value: Any, ttl_seconds: float = _CACHE_TTL_SECONDS) -> None:
  _set_schedule_cache(cache_key, {_OPTIONAL_CACHE_MARKER: True, "value": value}, ttl_seconds)


def _invalidate_schedule_cache() -> None:
  invalidate_cached_values("schedule-settings:")


def _fallback_schedule_type_token(value: str | None) -> str:
  normalized = normalize_schedule_type(value)
  return normalized or "none"


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


def normalize_weekly_category(value: str | None) -> str:
  if value is None:
    return DEFAULT_WEEKLY_CATEGORY

  token = value.strip().lower()
  if not token:
    return DEFAULT_WEEKLY_CATEGORY

  if token not in VALID_WEEKLY_CATEGORIES:
    raise ValueError("Category must be regular or jo.")

  return token


def category_to_schedule_type(category: str | None) -> str:
  return CATEGORY_SCHEDULE_TYPES[normalize_weekly_category(category)]


def schedule_type_to_category(schedule_type: str | None) -> str:
  normalized_schedule_type = normalize_schedule_type(schedule_type) or DEFAULT_SCHEDULE_TYPE
  return "jo" if normalized_schedule_type == "B" else DEFAULT_WEEKLY_CATEGORY


def schedule_type_from_required_minutes(required_minutes: Any) -> str:
  try:
    minutes_value = int(required_minutes)
  except (TypeError, ValueError):
    minutes_value = DEFAULT_REQUIRED_MINUTES

  return "B" if minutes_value >= 600 else "A"


def get_regular_schedule_preset(required_minutes: Any) -> dict:
  return get_weekly_schedule_preset(DEFAULT_WEEKLY_CATEGORY, required_minutes)


def get_weekly_schedule_preset(category: str | None, required_minutes: Any) -> dict:
  resolved_category = normalize_weekly_category(category)
  try:
    minutes_value = int(required_minutes)
  except (TypeError, ValueError):
    minutes_value = DEFAULT_REQUIRED_MINUTES

  presets = JO_PRESETS if resolved_category == "jo" else REGULAR_PRESETS
  return presets.get(minutes_value, presets[DEFAULT_REQUIRED_MINUTES])


def _get_weekly_late_threshold(category: str | None, day_of_week: int, preset: dict) -> str:
  resolved_category = normalize_weekly_category(category)
  if resolved_category == "jo":
    return preset["late_threshold_weekday"] if day_of_week < 5 else preset["late_threshold_weekend"]

  return preset["late_threshold_monday"] if day_of_week == 0 else preset["late_threshold_weekday"]


def _format_required_hours(total_minutes: int) -> str:
  return _format_minutes_as_time(total_minutes)


def _normalize_day_of_week(value: Any) -> int:
  day_of_week = int(value)
  if day_of_week < 0 or day_of_week > 6:
    raise ValueError("Day of week must be between 0 and 6.")
  return day_of_week


def _normalize_time_or_default(value: Any, default: str) -> str:
  try:
    normalized = normalize_time_token(value if value is None else str(value))
  except ValueError:
    return default

  if normalized is None or is_leave_code(normalized):
    return default

  return normalized


def clamp_regular_recorded_time(value: Any) -> str | None:
  return clamp_recorded_time(value, DEFAULT_WEEKLY_CATEGORY)


def clamp_recorded_time(value: Any, category: str | None = None) -> str | None:
  resolved_category = normalize_weekly_category(category)
  normalized = normalize_time_token(value if value is None else str(value))
  if normalized is None or is_leave_code(normalized):
    return normalized

  earliest_record_time = CATEGORY_EARLIEST_RECORD_TIME.get(resolved_category, DEFAULT_REGULAR_EARLIEST_RECORD_TIME)
  if to_minutes(normalized) is not None and to_minutes(normalized) < to_minutes(earliest_record_time):
    return earliest_record_time

  return normalized


def clamp_jo_recorded_time(value: Any) -> str | None:
  return clamp_recorded_time(value, "jo")


def _required_hours_to_minutes(value: Any) -> int:
  token = "" if value is None else str(value).strip()
  if not token:
    raise ValueError("Required hours must be a valid duration.")

  try:
    numeric_hours = float(token)
  except ValueError:
    normalized = normalize_time_token(token)
    if normalized is None or is_leave_code(normalized):
      raise ValueError("Required hours must be a valid duration.")

    required_minutes = to_minutes(normalized)
  else:
    required_minutes = int(round(numeric_hours * 60))

  if required_minutes is None or required_minutes <= 0:
    raise ValueError("Required hours must be greater than 0.")

  return required_minutes


def _default_weekly_schedule(day_of_week: int, category: str | None = None) -> dict:
  resolved_category = normalize_weekly_category(category)
  preset = get_weekly_schedule_preset(resolved_category, DEFAULT_REQUIRED_MINUTES)
  return {
    "category": resolved_category,
    "category_label": "Job Order" if resolved_category == "jo" else "Regular",
    "day_of_week": day_of_week,
    "day_name": WEEKDAY_NAMES[day_of_week],
    "schedule_start": preset["schedule_start"],
    "schedule_end": preset["schedule_end"],
    "late_threshold": _get_weekly_late_threshold(resolved_category, day_of_week, preset),
    "required_minutes": preset["required_minutes"],
    "required_hours": _format_required_hours(DEFAULT_REQUIRED_MINUTES),
    "schedule_type": schedule_type_from_required_minutes(preset["required_minutes"]) if resolved_category == DEFAULT_WEEKLY_CATEGORY else category_to_schedule_type(resolved_category),
    "has_override": False,
  }


def _serialize_weekly_schedule(row: dict | None, day_of_week: int, category: str | None = None) -> dict:
  default_schedule = _default_weekly_schedule(day_of_week, category)
  if not row:
    return default_schedule

  required_minutes = int(row.get("required_minutes") or DEFAULT_REQUIRED_MINUTES)
  resolved_category = normalize_weekly_category(row.get("category") or category)
  preset = get_weekly_schedule_preset(resolved_category, required_minutes)
  schedule_type = schedule_type_from_required_minutes(required_minutes) if resolved_category == DEFAULT_WEEKLY_CATEGORY else category_to_schedule_type(resolved_category)
  late_threshold = _normalize_time_or_default(row.get("late_threshold"), _get_weekly_late_threshold(resolved_category, day_of_week, preset))
  schedule_start = _normalize_time_or_default(row.get("schedule_start"), preset["schedule_start"])
  schedule_end = _normalize_time_or_default(row.get("schedule_end"), preset["schedule_end"])
  return {
    **default_schedule,
    "category": resolved_category,
    "category_label": "Job Order" if resolved_category == "jo" else "Regular",
    "schedule_start": schedule_start,
    "schedule_end": schedule_end,
    "late_threshold": late_threshold,
    "required_minutes": required_minutes,
    "required_hours": _format_required_hours(required_minutes),
    "schedule_type": row.get("schedule_type") or schedule_type,
    "has_override": False,
  }


def _fetch_legacy_weekly_schedule_for_day(day_of_week: int, category: str | None = None) -> dict:
  supabase = get_supabase_client()
  try:
    response = (
      supabase.table("weekly_schedule_settings")
      .select("day_of_week,schedule_start,schedule_end,late_threshold,required_minutes")
      .eq("day_of_week", day_of_week)
      .limit(1)
      .execute()
    )
  except Exception:
    return _default_weekly_schedule(day_of_week, category)

  return _serialize_weekly_schedule(response.data[0], day_of_week, category) if response.data else _default_weekly_schedule(day_of_week, category)


def fetch_weekly_schedule_for_day(day_of_week: int, category: str | None = None) -> dict:
  resolved_category = normalize_weekly_category(category)
  cache_key = _schedule_cache_key("weekly-day", resolved_category, str(day_of_week))
  cached_value = get_cached_value(cache_key)
  if cached_value is not None:
    return cached_value

  supabase = get_supabase_client()

  try:
    response = (
      supabase.table("weekly_schedule_settings")
      .select("category,day_of_week,schedule_start,schedule_end,late_threshold,required_minutes")
      .eq("category", resolved_category)
      .eq("day_of_week", day_of_week)
      .limit(1)
      .execute()
    )
    if response.data:
      result = _serialize_weekly_schedule(response.data[0], day_of_week, resolved_category)
      _set_schedule_cache(cache_key, result)
      return result
  except Exception:
    result = _fetch_legacy_weekly_schedule_for_day(day_of_week, resolved_category)
    _set_schedule_cache(cache_key, result)
    return result

  result = _default_weekly_schedule(day_of_week, resolved_category)
  _set_schedule_cache(cache_key, result)
  return result


def list_weekly_schedule_settings(category: str | None = None) -> list[dict]:
  resolved_category = normalize_weekly_category(category)
  cache_key = _schedule_cache_key("weekly-list", resolved_category)
  cached_value = get_cached_value(cache_key)
  if cached_value is not None:
    return cached_value

  supabase = get_supabase_client()
  try:
    response = (
      supabase.table("weekly_schedule_settings")
      .select("category,day_of_week,schedule_start,schedule_end,late_threshold,required_minutes")
      .eq("category", resolved_category)
      .order("day_of_week")
      .execute()
    )
  except Exception:
    legacy_response = None
    try:
      legacy_response = (
        supabase.table("weekly_schedule_settings")
        .select("day_of_week,schedule_start,schedule_end,late_threshold,required_minutes")
        .order("day_of_week")
        .execute()
      )
    except Exception:
      return [_default_weekly_schedule(day_of_week, resolved_category) for day_of_week in range(7)]

    rows_by_day: dict[int, dict] = {}
    for row in legacy_response.data or []:
      try:
        day_of_week = _normalize_day_of_week(row.get("day_of_week"))
      except (TypeError, ValueError):
        continue

      rows_by_day[day_of_week] = row

    result = [_serialize_weekly_schedule(rows_by_day.get(day_of_week), day_of_week, resolved_category) for day_of_week in range(7)]
    _set_schedule_cache(cache_key, result)
    return result

  rows_by_day: dict[int, dict] = {}
  for row in response.data or []:
    try:
      day_of_week = _normalize_day_of_week(row.get("day_of_week"))
    except (TypeError, ValueError):
      continue

    rows_by_day[day_of_week] = row

  result = [_serialize_weekly_schedule(rows_by_day.get(day_of_week), day_of_week, resolved_category) for day_of_week in range(7)]
  _set_schedule_cache(cache_key, result)
  return result


def upsert_weekly_schedule_settings(category: str, schedule_rows: list[dict]) -> list[dict]:
  resolved_category = normalize_weekly_category(category)
  if len(schedule_rows) != 7:
    raise ValueError("Weekly schedule must include all 7 days.")

  normalized_rows: list[dict] = []
  seen_days: set[int] = set()
  for row in schedule_rows:
    day_of_week = _normalize_day_of_week(row.get("day_of_week"))
    if day_of_week in seen_days:
      raise ValueError("Weekly schedule contains duplicate days.")

    seen_days.add(day_of_week)
    normalized_rows.append(
      {
        "category": resolved_category,
        "day_of_week": day_of_week,
        "schedule_start": _normalize_time_or_default(row.get("schedule_start"), DEFAULT_SCHEDULE_START),
        "schedule_end": _normalize_time_or_default(row.get("schedule_end"), DEFAULT_SCHEDULE_END),
        "late_threshold": _normalize_time_or_default(row.get("late_threshold"), DEFAULT_LATE_THRESHOLD),
        "required_minutes": _required_hours_to_minutes(row.get("required_hours"))
      }
    )

    if resolved_category == DEFAULT_WEEKLY_CATEGORY and normalized_rows[-1]["required_minutes"] not in REGULAR_PRESETS:
      raise ValueError("Regular schedule must be either 8 hours or 10 hours.")

  if seen_days != set(range(7)):
    raise ValueError("Weekly schedule must include every day of the week.")

  supabase = get_supabase_client()
  try:
    response = supabase.table("weekly_schedule_settings").upsert(normalized_rows, on_conflict="category,day_of_week").execute()
  except Exception as error:
    if resolved_category != DEFAULT_WEEKLY_CATEGORY:
      raise ValueError("weekly_schedule_settings table needs category support. Run supabase_schema.sql to separate regular and JO schedules.") from error

    legacy_rows = [
      {key: value for key, value in row.items() if key != "category"}
      for row in normalized_rows
    ]
    try:
      response = supabase.table("weekly_schedule_settings").upsert(legacy_rows, on_conflict="day_of_week").execute()
    except Exception as legacy_error:
      raise ValueError("weekly_schedule_settings table is missing. Run supabase_schema.sql first.") from legacy_error

  if not response.data:
    raise ValueError("Failed to save weekly schedule settings.")

  _invalidate_schedule_cache()
  return list_weekly_schedule_settings(resolved_category)


def _compose_schedule_context(
  date_value: str,
  category: str | None,
  fallback_schedule_type: str | None,
  weekly_schedule: dict,
  override: dict | None = None
) -> dict:
  resolved_category = normalize_weekly_category(category)
  schedule_type = normalize_schedule_type((override or {}).get("schedule_type")) or weekly_schedule.get("schedule_type") or normalize_schedule_type(fallback_schedule_type) or category_to_schedule_type(resolved_category)

  if override:
    schedule_start_minutes, schedule_end_minutes, required_minutes, _ = get_schedule_details(schedule_type)
    schedule_start = _format_minutes_as_time(schedule_start_minutes)
    schedule_end = _format_minutes_as_time(schedule_end_minutes)
    late_threshold = normalize_late_threshold((override or {}).get("late_threshold")) or get_default_late_threshold(schedule_type)
  else:
    schedule_start = weekly_schedule["schedule_start"]
    schedule_end = weekly_schedule["schedule_end"]
    required_minutes = int(weekly_schedule.get("required_minutes") or DEFAULT_REQUIRED_MINUTES)
    late_threshold = weekly_schedule["late_threshold"]

  return {
    **weekly_schedule,
    "date": date_value,
    "category": resolved_category,
    "schedule_type": schedule_type,
    "schedule_start": schedule_start,
    "schedule_end": schedule_end,
    "required_minutes": required_minutes,
    "required_hours": _format_required_hours(required_minutes),
    "late_threshold": late_threshold,
    "has_override": bool(override),
    "schedule_source": "date_override" if override else "weekly"
  }


def _build_weekly_schedule_index(category: str | None) -> dict[int, dict]:
  return {
    int(row["day_of_week"]): row
    for row in list_weekly_schedule_settings(category)
  }


def _build_schedule_override_index(date_values: set[str], category: str | None = None) -> dict[str, dict]:
  if not date_values:
    return {}

  sorted_dates = sorted(date_values)
  overrides = list_schedule_overrides(sorted_dates[0], sorted_dates[-1], category)
  return {
    row["date"]: row
    for row in overrides
    if row.get("date") in date_values
  }


def get_default_late_threshold(schedule_type: str | None = None) -> str:
  resolved_schedule_type = normalize_schedule_type(schedule_type) or DEFAULT_SCHEDULE_TYPE
  schedule_start_minutes, _, _, _ = get_schedule_details(resolved_schedule_type)
  return _format_minutes_as_time(schedule_start_minutes)


def fetch_schedule_override(date_value: str, category: str | None = None) -> dict | None:
  resolved_category = normalize_weekly_category(category)
  cache_key = _schedule_cache_key("override", resolved_category, date_value)
  cached_found, cached_value = _read_optional_schedule_cache(cache_key)
  if cached_found:
    return cached_value

  supabase = get_supabase_client()
  try:
    response = (
      supabase.table("schedule_settings")
      .select("category,date,schedule_type,late_threshold")
      .eq("category", resolved_category)
      .eq("date", date_value)
      .limit(1)
      .execute()
    )
  except Exception:
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
      _write_optional_schedule_cache(cache_key, None)
      return None

    result = response.data[0]
    _write_optional_schedule_cache(cache_key, result)
    return result

  if not response.data:
    _write_optional_schedule_cache(cache_key, None)
    return None

  result = response.data[0]
  _write_optional_schedule_cache(cache_key, result)
  return result


def list_schedule_overrides(date_from: str, date_to: str, category: str | None = None) -> list[dict]:
  start_date = Date.fromisoformat(date_from)
  end_date = Date.fromisoformat(date_to)
  if start_date > end_date:
    raise ValueError("From date must be earlier than or equal to to date.")

  resolved_category = normalize_weekly_category(category)
  cache_key = _schedule_cache_key("overrides", resolved_category, start_date.isoformat(), end_date.isoformat())
  cached_value = get_cached_value(cache_key)
  if cached_value is not None:
    return cached_value

  supabase = get_supabase_client()
  try:
    response = (
      supabase.table("schedule_settings")
      .select("category,date,schedule_type,late_threshold")
      .eq("category", resolved_category)
      .gte("date", start_date.isoformat())
      .lte("date", end_date.isoformat())
      .order("date")
      .execute()
    )
  except Exception:
    try:
      response = (
        supabase.table("schedule_settings")
        .select("date,schedule_type,late_threshold")
        .gte("date", start_date.isoformat())
        .lte("date", end_date.isoformat())
        .order("date")
        .execute()
      )
    except Exception:
      return []

    result = response.data or []
    _set_schedule_cache(cache_key, result)
    return result

  result = response.data or []
  _set_schedule_cache(cache_key, result)
  return result


def resolve_schedule_context(date_value: str, category: str | None = None, fallback_schedule_type: str | None = None) -> dict:
  resolved_category = normalize_weekly_category(category)
  fallback_token = _fallback_schedule_type_token(fallback_schedule_type)
  cache_key = _schedule_cache_key("context", date_value, resolved_category, fallback_token)
  cached_value = get_cached_value(cache_key)
  if cached_value is not None:
    return cached_value

  date_value_obj = Date.fromisoformat(date_value)
  weekly_schedule = fetch_weekly_schedule_for_day(date_value_obj.weekday(), resolved_category)
  override = fetch_schedule_override(date_value, resolved_category)
  result = _compose_schedule_context(date_value, resolved_category, fallback_schedule_type, weekly_schedule, override)
  _set_schedule_cache(cache_key, result)
  return result


def toggle_schedule_override(date_value: str, category: str | None = None) -> dict:
  resolved_category = normalize_weekly_category(category)
  date_value_obj = Date.fromisoformat(date_value)
  current = fetch_schedule_override(date_value, resolved_category)
  supabase = get_supabase_client()

  if current and normalize_schedule_type(current.get("schedule_type")) == "B":
    delete_query = supabase.table("schedule_settings").delete().eq("date", date_value)
    try:
      response = delete_query.eq("category", resolved_category).execute()
    except Exception:
      response = supabase.table("schedule_settings").delete().eq("date", date_value).execute()
    if response.data is None:
      raise ValueError("Failed to clear schedule override.")

    _invalidate_schedule_cache()
    updated_rows = recalculate_attendance_for_date(date_value, resolved_category)
    return {
      "date": date_value,
      "category": resolved_category,
      "enabled": False,
      "has_override": False,
      "updated_count": len(updated_rows)
    }

  regular_preset = get_weekly_schedule_preset(resolved_category, 600)
  late_threshold = _get_weekly_late_threshold(resolved_category, date_value_obj.weekday(), regular_preset)
  values = {
    "date": date_value,
    "category": resolved_category,
    "schedule_type": "B",
    "late_threshold": late_threshold,
  }
  try:
    response = supabase.table("schedule_settings").upsert(
      values,
      on_conflict="category,date",
    ).execute()
  except Exception as error:
    if resolved_category != DEFAULT_WEEKLY_CATEGORY:
      raise ValueError("schedule_settings table needs category support. Run supabase_schema.sql to separate regular and JO schedule overrides.") from error

    legacy_values = {key: value for key, value in values.items() if key != "category"}
    response = supabase.table("schedule_settings").upsert(
      legacy_values,
      on_conflict="date",
    ).execute()
  if not response.data:
    raise ValueError("Failed to save schedule settings.")

  saved = response.data[0]
  _invalidate_schedule_cache()
  updated_rows = recalculate_attendance_for_date(date_value, resolved_category)

  return {
    "date": saved["date"],
    "category": resolved_category,
    "schedule_type": saved.get("schedule_type") or "B",
    "late_threshold": normalize_late_threshold(saved.get("late_threshold")) or late_threshold,
    "enabled": True,
    "has_override": True,
    "updated_count": len(updated_rows)
  }


def get_schedule_display_values(date_value: str, category: str | None = None, fallback_schedule_type: str | None = None) -> dict:
  return resolve_schedule_context(date_value, category, fallback_schedule_type)


def upsert_schedule_setting(date_value: str, schedule_type: str | None, late_threshold: str, category: str | None = None) -> dict:
  resolved_category = normalize_weekly_category(category)
  current = fetch_schedule_override(date_value, resolved_category)
  resolved_schedule_type = normalize_schedule_type(schedule_type or (current or {}).get("schedule_type")) or DEFAULT_SCHEDULE_TYPE
  resolved_late_threshold = normalize_late_threshold(late_threshold) or get_default_late_threshold(resolved_schedule_type)

  supabase = get_supabase_client()
  values = {
    "date": date_value,
    "category": resolved_category,
    "schedule_type": resolved_schedule_type,
    "late_threshold": resolved_late_threshold
  }
  try:
    response = supabase.table("schedule_settings").upsert(values, on_conflict="category,date").execute()
  except Exception as error:
    if resolved_category != DEFAULT_WEEKLY_CATEGORY:
      raise ValueError("schedule_settings table needs category support. Run supabase_schema.sql to separate regular and JO schedule overrides.") from error

    legacy_values = {key: value for key, value in values.items() if key != "category"}
    response = supabase.table("schedule_settings").upsert(legacy_values, on_conflict="date").execute()

  if not response.data:
    raise ValueError("Failed to save schedule settings.")

  _invalidate_schedule_cache()
  return response.data[0]


def _load_employee_categories() -> dict[int, str]:
  supabase = get_supabase_client()
  try:
    response = supabase.table("employees").select("id,category").execute()
  except Exception:
    return {}

  categories: dict[int, str] = {}
  for row in response.data or []:
    try:
      employee_id = int(row.get("id"))
    except (TypeError, ValueError):
      continue

    try:
      categories[employee_id] = normalize_weekly_category(row.get("category"))
    except ValueError:
      categories[employee_id] = DEFAULT_WEEKLY_CATEGORY

  return categories


def _recalculate_attendance_rows(attendance_rows: list[dict], employee_categories: dict[int, str], category: str | None = None) -> list[dict]:
  supabase = get_supabase_client()
  resolved_filter = normalize_weekly_category(category) if category else None
  target_rows: list[tuple[dict, str, str, Date]] = []
  date_values: set[str] = set()
  categories_needed: set[str] = set()

  for row in attendance_rows:
    date_value = str(row.get("date") or "")
    if not date_value:
      continue

    employee_id = row.get("employee_id")
    try:
      employee_id_value = int(employee_id) if employee_id is not None else None
    except (TypeError, ValueError):
      employee_id_value = None

    row_category = employee_categories.get(employee_id_value, DEFAULT_WEEKLY_CATEGORY) if employee_id_value is not None else DEFAULT_WEEKLY_CATEGORY
    if resolved_filter and row_category != resolved_filter:
      continue

    target_rows.append((row, row_category, date_value, Date.fromisoformat(date_value)))
    date_values.add(date_value)
    categories_needed.add(row_category)

  if not target_rows:
    return []

  weekly_schedule_maps = {
    row_category: _build_weekly_schedule_index(row_category)
    for row_category in categories_needed
  }
  override_by_category = {
    row_category: _build_schedule_override_index(date_values, row_category)
    for row_category in categories_needed
  }

  pending_updates: list[dict] = []
  for row, row_category, date_value, date_value_obj in target_rows:
    weekly_schedule = weekly_schedule_maps.get(row_category, {}).get(date_value_obj.weekday())
    if not weekly_schedule:
      weekly_schedule = _default_weekly_schedule(date_value_obj.weekday(), row_category)

    context = _compose_schedule_context(date_value, row_category, row.get("schedule_type"), weekly_schedule, override_by_category.get(row_category, {}).get(date_value))

    leave_type = (row.get("leave_type") or "").strip().upper() or None
    time_in_value = row.get("time_in")
    time_out_value = row.get("time_out")
    if row_category == DEFAULT_WEEKLY_CATEGORY:
      time_in_value = clamp_regular_recorded_time(time_in_value)

    if not leave_type:
      normalized_time_in = normalize_time_token(time_in_value)
      normalized_time_out = normalize_time_token(time_out_value)
      if is_leave_code(normalized_time_in):
        leave_type = normalized_time_in
      elif is_leave_code(normalized_time_out):
        leave_type = normalized_time_out

    if leave_type == "OB":
      late_minutes, undertime_minutes, overtime_minutes, normalized_in, normalized_out = calculate_dtr_metrics(
        context,
        time_in_value,
        time_out_value,
        leave_type,
        context.get("late_threshold")
      )
    elif leave_type:
      late_minutes = 0
      undertime_minutes = 0
      overtime_minutes = 0
      normalized_in = None
      normalized_out = None
    else:
      late_minutes, undertime_minutes, overtime_minutes, normalized_in, normalized_out = calculate_dtr_metrics(
        context,
        time_in_value,
        time_out_value,
        None,
        context.get("late_threshold")
      )

    row_id = row.get("id")
    if row_id is None:
      continue

    pending_updates.append(
      {
        "id": row_id,
        "employee_id": row.get("employee_id"),
        "date": row.get("date"),
        "schedule_type": context.get("schedule_type") or row.get("schedule_type") or DEFAULT_SCHEDULE_TYPE,
        "time_in": normalized_in,
        "time_out": normalized_out,
        "late_minutes": late_minutes,
        "undertime_minutes": undertime_minutes,
        "overtime_minutes": overtime_minutes,
        "leave_type": leave_type
      }
    )

  if not pending_updates:
    return []

  updated_rows: list[dict] = []
  batch_size = 250
  for start_index in range(0, len(pending_updates), batch_size):
    batch = pending_updates[start_index:start_index + batch_size]
    result = supabase.table("attendance").upsert(batch, on_conflict="id").execute()
    if result.data:
      updated_rows.extend(result.data)
    else:
      updated_rows.extend(batch)

  return updated_rows


def recalculate_attendance_for_date(date_value: str, category: str | None = None) -> list[dict]:
  supabase = get_supabase_client()
  response = (
    supabase.table("attendance")
    .select("id,employee_id,date,time_in,time_out,leave_type,schedule_type")
    .eq("date", date_value)
    .execute()
  )

  return _recalculate_attendance_rows(response.data or [], _load_employee_categories(), category)


def recalculate_attendance_for_category(date_value: str, category: str) -> list[dict]:
  supabase = get_supabase_client()
  response = (
    supabase.table("attendance")
    .select("id,employee_id,date,time_in,time_out,leave_type,schedule_type")
    .eq("date", date_value)
    .execute()
  )

  return _recalculate_attendance_rows(response.data or [], _load_employee_categories(), category)


def calculate_attendance_snapshot(
  date_value: str,
  category: str | None,
  schedule_type: str | None,
  time_in: str | None,
  time_out: str | None,
  leave_type: str | None
) -> dict:
  resolved_category = normalize_weekly_category(category)
  fallback_schedule_type = normalize_schedule_type(schedule_type) or category_to_schedule_type(resolved_category)
  schedule_context = resolve_schedule_context(date_value, resolved_category, fallback_schedule_type)

  normalized_leave = (leave_type or "").strip().upper() or None
  if normalized_leave and normalized_leave != "OB":
    late_minutes = 0
    undertime_minutes = 0
    overtime_minutes = 0
  else:
    late_minutes, undertime_minutes, overtime_minutes, _, _ = calculate_dtr_metrics(
      schedule_context,
      time_in,
      time_out,
      normalized_leave,
      schedule_context.get("late_threshold")
    )

  return {
    "schedule_type": schedule_context.get("schedule_type") or fallback_schedule_type,
    "late_minutes": late_minutes,
    "undertime_minutes": undertime_minutes,
    "overtime_minutes": overtime_minutes,
  }


def recalculate_all_attendance(category: str | None = None) -> list[dict]:
  supabase = get_supabase_client()
  response = supabase.table("attendance").select("id,employee_id,date,time_in,time_out,leave_type,schedule_type").execute()
  return _recalculate_attendance_rows(response.data or [], _load_employee_categories(), category)