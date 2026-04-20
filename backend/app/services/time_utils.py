from datetime import datetime
from zoneinfo import ZoneInfo

from ..config import settings

LEAVE_CODES = {"SL", "VL", "OB"}
LUNCH_BREAK_START = 12 * 60
LUNCH_BREAK_END = 13 * 60
SCHEDULE_DEFINITIONS = {
  "A": {"start": "08:00", "end": "17:00", "required_minutes": 480, "break_minutes": 60},
  "B": {"start": "08:00", "end": "19:00", "required_minutes": 600, "break_minutes": 60}
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

  for pattern in ("%H:%M", "%H:%M:%S", "%I:%M %p", "%I:%M:%S %p", "%I:%M%p", "%I:%M:%S%p"):
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


def get_schedule_details(schedule_type: str | None) -> tuple[int, int, int, int]:
  selected = SCHEDULE_DEFINITIONS.get((schedule_type or "A").upper(), SCHEDULE_DEFINITIONS["A"])
  start_minutes = to_minutes(selected["start"]) or 480
  end_minutes = to_minutes(selected["end"]) or 1020
  break_minutes = int(selected.get("break_minutes") or 60)
  required_minutes = int(selected.get("required_minutes") or max(end_minutes - start_minutes - break_minutes, 0))
  return start_minutes, end_minutes, required_minutes, break_minutes


def get_schedule_window(schedule_type: str | None) -> tuple[int, int]:
  start_minutes, end_minutes, _, _ = get_schedule_details(schedule_type)
  return start_minutes, end_minutes


def _elapsed_minutes_excluding_lunch(start_minutes: int | None, end_minutes: int | None) -> int:
  if start_minutes is None or end_minutes is None:
    return 0

  gross_minutes = max(end_minutes - start_minutes, 0)
  if gross_minutes == 0:
    return 0

  lunch_overlap_start = max(start_minutes, LUNCH_BREAK_START)
  lunch_overlap_end = min(end_minutes, LUNCH_BREAK_END)
  lunch_overlap_minutes = max(lunch_overlap_end - lunch_overlap_start, 0)

  return max(gross_minutes - lunch_overlap_minutes, 0)


def calculate_dtr_metrics(
  schedule_type: str,
  time_in: str | None,
  time_out: str | None,
  leave_type: str | None,
  late_threshold: str | None = None
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
  schedule_start, _, required_minutes, _break_minutes = get_schedule_details(schedule_type)
  late_threshold_minutes = to_minutes(late_threshold)
  if late_threshold_minutes is None:
    late_threshold_minutes = schedule_start

  late_minutes = _elapsed_minutes_excluding_lunch(late_threshold_minutes, time_in_minutes)

  undertime_minutes = 0
  if time_in_minutes is not None and time_out_minutes is not None:
    credited_start = max(time_in_minutes, schedule_start)
    credited_work_minutes = _elapsed_minutes_excluding_lunch(credited_start, time_out_minutes)
    undertime_minutes = max(required_minutes - credited_work_minutes, 0)

  overtime_minutes = 0
  return late_minutes, undertime_minutes, overtime_minutes, normalized_in, normalized_out
