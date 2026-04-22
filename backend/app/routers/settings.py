from fastapi import APIRouter, HTTPException

from ..schemas import AuthorizedEmailCreate, AuthorizedEmailStatusUpdate, ScheduleOverrideToggle, ScheduleThresholdUpdate, WeeklyScheduleUpdate
from ..services.cache_revision import build_cache_revision, invalidate_cache_revision
from ..services.schedule_settings import (
  get_schedule_display_values,
  list_weekly_schedule_settings,
  normalize_late_threshold,
  list_schedule_overrides,
  recalculate_all_attendance,
  recalculate_attendance_for_category,
  toggle_schedule_override,
  upsert_schedule_setting,
  upsert_weekly_schedule_settings,
)
from ..services.realtime import publish_event
from ..services.response_cache import get_cached_value, set_cached_value, invalidate_cached_values
from ..supabase_client import get_supabase_client

router = APIRouter(prefix="/settings", tags=["settings"])
DEFAULT_LATE_THRESHOLD = "08:00"


def normalize_email(value: str) -> str:
  return value.strip().lower()


def get_late_threshold_for_date(date_value: str) -> str:
  return get_schedule_display_values(date_value).get("late_threshold") or DEFAULT_LATE_THRESHOLD


@router.get("/auth-emails")
def list_authorized_emails() -> list[dict]:
  supabase = get_supabase_client()
  response = (
    supabase.table("auth_allowed_emails")
    .select("id,email,enabled,created_at")
    .order("enabled", desc=True)
    .order("email")
    .execute()
  )
  return response.data or []


@router.post("/auth-emails")
async def add_authorized_email(payload: AuthorizedEmailCreate) -> dict:
  supabase = get_supabase_client()
  email = normalize_email(str(payload.email))
  response = (
    supabase.table("auth_allowed_emails")
    .upsert({"email": email, "enabled": True}, on_conflict="email")
    .execute()
  )

  if not response.data:
    raise HTTPException(status_code=500, detail="Failed to save authorized email.")

  saved = response.data[0]
  await publish_event(
    "settings.auth_email.added",
    f"Authorized email added: {saved['email']}",
    saved,
  )
  return saved


@router.patch("/auth-emails/{email_id}")
async def update_authorized_email(email_id: int, payload: AuthorizedEmailStatusUpdate) -> dict:
  supabase = get_supabase_client()

  existing_response = (
    supabase.table("auth_allowed_emails")
    .select("id,email,enabled,created_at")
    .eq("id", email_id)
    .limit(1)
    .execute()
  )
  if not existing_response.data:
    raise HTTPException(status_code=404, detail="Authorized email not found.")

  existing = existing_response.data[0]
  if existing.get("enabled") and not payload.enabled:
    enabled_rows = (
      supabase.table("auth_allowed_emails")
      .select("id")
      .eq("enabled", True)
      .execute()
      .data
      or []
    )
    if len(enabled_rows) <= 1:
      raise HTTPException(status_code=400, detail="At least one authorized email must remain enabled.")

  response = (
    supabase.table("auth_allowed_emails")
    .update({"enabled": payload.enabled})
    .eq("id", email_id)
    .execute()
  )

  if not response.data:
    raise HTTPException(status_code=404, detail="Authorized email not found.")

  updated = response.data[0]
  action = "enabled" if payload.enabled else "disabled"
  await publish_event(
    "settings.auth_email.updated",
    f"Authorized email {action}: {updated['email']}",
    updated,
  )
  return updated


@router.get("/schedule-threshold")
def get_schedule_threshold(date: str, category: str = "regular") -> dict:
  cache_key = f"settings:schedule-threshold:{category}:{date}"
  cached_value = get_cached_value(cache_key)
  if cached_value is not None:
    return cached_value

  result = get_schedule_display_values(date, category)
  set_cached_value(cache_key, result)
  return result


@router.get("/weekly-schedules")
def get_weekly_schedules(category: str = "regular") -> list[dict]:
  cache_key = f"settings:weekly-schedules:{category}"
  cached_value = get_cached_value(cache_key)
  if cached_value is not None:
    return cached_value

  result = list_weekly_schedule_settings(category)
  set_cached_value(cache_key, result)
  return result


@router.get("/schedule-overrides")
def get_schedule_overrides(date_from: str, date_to: str, category: str = "regular") -> list[dict]:
  cache_key = f"settings:schedule-overrides:{category}:{date_from}:{date_to}"
  cached_value = get_cached_value(cache_key)
  if cached_value is not None:
    return cached_value

  result = list_schedule_overrides(date_from, date_to, category)
  set_cached_value(cache_key, result)
  return result


@router.get("/cache-revision")
def get_cache_revision() -> dict:
  return {
    "revision": build_cache_revision()
  }


@router.put("/schedule-threshold")
async def set_schedule_threshold(payload: ScheduleThresholdUpdate) -> dict:
  try:
    saved = upsert_schedule_setting(payload.date.isoformat(), payload.schedule_type, payload.late_threshold, payload.category)
    updated_rows = recalculate_attendance_for_category(payload.date.isoformat(), payload.category)
  except ValueError as error:
    raise HTTPException(status_code=400, detail=str(error)) from error

  result = {
    "date": saved["date"],
    "category": saved.get("category") or payload.category,
    "schedule_type": saved.get("schedule_type") or "A",
    "late_threshold": normalize_late_threshold(saved.get("late_threshold")) or DEFAULT_LATE_THRESHOLD,
    "has_override": True,
    "updated_count": len(updated_rows)
  }

  invalidate_cache_revision()
  invalidate_cached_values()
  await publish_event(
    "attendance.updated",
    f"Schedule updated for {payload.date.isoformat()} ({result['schedule_type']}, late {result['late_threshold']}); recalculated {result['updated_count']} attendance rows.",
    result
  )

  return result


@router.post("/schedule-overrides/toggle")
async def toggle_schedule_override_route(payload: ScheduleOverrideToggle) -> dict:
  try:
    result = toggle_schedule_override(payload.date.isoformat(), payload.category)
  except ValueError as error:
    raise HTTPException(status_code=400, detail=str(error)) from error

  invalidate_cache_revision()
  invalidate_cached_values()
  await publish_event(
    "attendance.updated",
    f"Schedule override {'enabled' if result.get('enabled') else 'cleared'} for {payload.date.isoformat()}; recalculated {result['updated_count']} attendance rows.",
    result
  )

  return result


@router.put("/weekly-schedules")
async def set_weekly_schedules(payload: WeeklyScheduleUpdate) -> dict:
  try:
    saved_rows = upsert_weekly_schedule_settings(payload.category, [item.model_dump() for item in payload.schedules])
    updated_rows = recalculate_all_attendance(payload.category)
  except ValueError as error:
    raise HTTPException(status_code=400, detail=str(error)) from error

  result = {
    "schedules": saved_rows,
    "category": payload.category,
    "updated_count": len(updated_rows)
  }

  invalidate_cache_revision()
  invalidate_cached_values()
  await publish_event(
    "attendance.updated",
    f"Weekly schedule updated; recalculated {result['updated_count']} attendance rows.",
    result
  )

  return result
