from __future__ import annotations

from threading import Lock
from time import monotonic

from ..supabase_client import get_supabase_client

_CACHE_REVISION_TTL_SECONDS = 3.0
_ATTENDANCE_MATH_REVISION = "attendance-math:v3"
_revision_lock = Lock()
_cached_revision: str | None = None
_cached_revision_expires_at = 0.0


def _table_snapshot(table_name: str, timestamp_column: str) -> str:
  supabase = get_supabase_client()

  count_response = (
    supabase.table(table_name)
    .select("id", count="exact")
    .limit(1)
    .execute()
  )
  count = int(getattr(count_response, "count", 0) or 0)

  latest_response = (
    supabase.table(table_name)
    .select(timestamp_column)
    .order(timestamp_column, desc=True)
    .limit(1)
    .execute()
  )
  latest_value = ""
  if latest_response.data:
    latest_value = str(latest_response.data[0].get(timestamp_column) or "")

  return f"{table_name}:{count}:{latest_value}"


def build_cache_revision() -> str:
  global _cached_revision, _cached_revision_expires_at

  now = monotonic()
  with _revision_lock:
    if _cached_revision is not None and now < _cached_revision_expires_at:
      return _cached_revision

  snapshots: list[str] = [_ATTENDANCE_MATH_REVISION]
  for table_name, timestamp_column in (
    ("employees", "created_at"),
    ("attendance", "updated_at"),
    ("leave_types", "updated_at"),
    ("employee_leave_balances", "updated_at"),
    ("schedule_settings", "created_at"),
    ("weekly_schedule_settings", "updated_at"),
  ):
    try:
      snapshots.append(_table_snapshot(table_name, timestamp_column))
    except Exception:
      snapshots.append(f"{table_name}:reset")

  revision = "|".join(snapshots)

  with _revision_lock:
    _cached_revision = revision
    _cached_revision_expires_at = monotonic() + _CACHE_REVISION_TTL_SECONDS

  return revision


def invalidate_cache_revision() -> None:
  global _cached_revision, _cached_revision_expires_at

  with _revision_lock:
    _cached_revision = None
    _cached_revision_expires_at = 0.0