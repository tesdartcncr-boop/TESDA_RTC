from __future__ import annotations

from ..supabase_client import get_supabase_client


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
  snapshots: list[str] = []
  for table_name, timestamp_column in (
    ("employees", "created_at"),
    ("attendance", "updated_at"),
    ("schedule_settings", "created_at"),
  ):
    try:
      snapshots.append(_table_snapshot(table_name, timestamp_column))
    except Exception:
      snapshots.append(f"{table_name}:reset")

  return "|".join(snapshots)