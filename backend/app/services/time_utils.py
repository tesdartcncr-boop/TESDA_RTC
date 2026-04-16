from datetime import datetime
from zoneinfo import ZoneInfo

from ..config import settings

LEAVE_CODES = {"SL", "VL", "OB"}
SCHEDULE_DEFINITIONS = {
  "A": {"start": "08:00", "end": "17:00"},
  "B": {"start": "08:00", "end": "19:00"}
}


def now_military_time() -> str:
  return datetime.now(ZoneInfo(settings.app_timezone)).strftime("%H:%M")


def now_app_date() -> str:
  return datetime.now(ZoneInfo(settings.app_timezone)).date().isoformat()


def normalize_time_token(value: str | None) -> str | None:
  if value is None:
    return None

  token = value.strip().upper()
  if not token:
    return None

  if token in LEAVE_CODES:
    return token

  for pattern in ("%H:%M", "%I:%M %p", "%I:%M%p"):
    try:
      return datetime.strptime(token, pattern).strftime("%H:%M")
    except ValueError:
      continue

  raise ValueError("Invalid time format. Use HH:MM or h:mm AM/PM.")


def is_leave_code(value: str | None) -> bool:
  if not value:
    return False
  return value.upper() in LEAVE_CODES


def to_minutes(token: str | None) -> int | None:
  normalized = normalize_time_token(token)
  if normalized is None or normalized in LEAVE_CODES:
    return None

  hours, minutes = normalized.split(":")
  return int(hours) * 60 + int(minutes)


def get_schedule_window(schedule_type: str | None) -> tuple[int, int]:
  selected = SCHEDULE_DEFINITIONS.get((schedule_type or "A").upper(), SCHEDULE_DEFINITIONS["A"])
  start_minutes = to_minutes(selected["start"])
  end_minutes = to_minutes(selected["end"])
  return start_minutes or 480, end_minutes or 1020


def calculate_dtr_metrics(
  schedule_type: str,
  time_in: str | None,
  time_out: str | None,
  late_threshold: str,
  leave_type: str | None
) -> tuple[int, int, int, str | None, str | None]:
  normalized_in = normalize_time_token(time_in)
  normalized_out = normalize_time_token(time_out)
  normalized_leave = (leave_type or "").upper() or None

  # Full-day leave codes bypass late/undertime/overtime computation.
  if normalized_leave in LEAVE_CODES:
    return 0, 0, 0, normalized_leave, normalized_leave

  if normalized_in in LEAVE_CODES or normalized_out in LEAVE_CODES:
    leave_code = normalized_in if normalized_in in LEAVE_CODES else normalized_out
    return 0, 0, 0, leave_code, leave_code

  time_in_minutes = to_minutes(normalized_in)
  time_out_minutes = to_minutes(normalized_out)
  threshold_minutes = to_minutes(late_threshold) or 481
  _, schedule_end = get_schedule_window(schedule_type)

  late_minutes = max((time_in_minutes or threshold_minutes) - threshold_minutes, 0)

  undertime_minutes = 0
  overtime_minutes = 0
  # Undertime and overtime are computed once time-out is available.
  if time_out_minutes is not None:
    undertime_minutes = max(schedule_end - time_out_minutes, 0)
    overtime_minutes = max(time_out_minutes - schedule_end, 0)

  return late_minutes, undertime_minutes, overtime_minutes, normalized_in, normalized_out
