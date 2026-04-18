from fastapi import APIRouter, HTTPException

from ..schemas import AuthorizedEmailCreate, AuthorizedEmailStatusUpdate, ScheduleThresholdUpdate
from ..services.cache_revision import build_cache_revision
from ..services.schedule_settings import get_schedule_display_values, normalize_late_threshold, recalculate_attendance_for_date, upsert_schedule_setting
from ..services.realtime import publish_event
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
def get_schedule_threshold(date: str) -> dict:
  return get_schedule_display_values(date)


@router.get("/cache-revision")
def get_cache_revision() -> dict:
  return {
    "revision": build_cache_revision()
  }


@router.put("/schedule-threshold")
async def set_schedule_threshold(payload: ScheduleThresholdUpdate) -> dict:
  try:
    saved = upsert_schedule_setting(payload.date.isoformat(), payload.schedule_type, payload.late_threshold)
    updated_rows = recalculate_attendance_for_date(payload.date.isoformat(), saved["schedule_type"], saved.get("late_threshold"))
  except ValueError as error:
    raise HTTPException(status_code=400, detail=str(error)) from error

  result = {
    "date": saved["date"],
    "schedule_type": saved.get("schedule_type") or "A",
    "late_threshold": normalize_late_threshold(saved.get("late_threshold")) or DEFAULT_LATE_THRESHOLD,
    "has_override": True,
    "updated_count": len(updated_rows)
  }

  await publish_event(
    "attendance.updated",
    f"Schedule updated for {payload.date.isoformat()} ({result['schedule_type']}, late {result['late_threshold']}); recalculated {result['updated_count']} attendance rows.",
    result
  )

  return result
