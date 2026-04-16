from fastapi import APIRouter

from ..schemas import ScheduleThresholdUpdate
from ..services.realtime import publish_event
from ..supabase_client import get_supabase_client

router = APIRouter(prefix="/settings", tags=["settings"])
DEFAULT_LATE_THRESHOLD = "08:00"


def get_late_threshold_for_date(date_value: str) -> str:
  supabase = get_supabase_client()
  response = (
    supabase.table("schedule_settings")
    .select("late_threshold")
    .eq("date", date_value)
    .limit(1)
    .execute()
  )

  if not response.data:
    return DEFAULT_LATE_THRESHOLD

  return response.data[0].get("late_threshold") or DEFAULT_LATE_THRESHOLD


@router.get("/schedule-threshold")
def get_schedule_threshold(date: str) -> dict:
  return {
    "date": date,
    "late_threshold": get_late_threshold_for_date(date)
  }


@router.put("/schedule-threshold")
async def set_schedule_threshold(payload: ScheduleThresholdUpdate) -> dict:
  supabase = get_supabase_client()
  values = {
    "date": payload.date.isoformat(),
    "late_threshold": payload.late_threshold
  }
  (
    supabase.table("schedule_settings")
    .upsert(values, on_conflict="date")
    .execute()
  )

  await publish_event(
    "settings.threshold.updated",
    f"Late threshold set to {payload.late_threshold} on {payload.date.isoformat()}",
    values
  )

  return values
