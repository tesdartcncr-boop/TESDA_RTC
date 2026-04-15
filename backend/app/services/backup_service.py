import json
from datetime import datetime
from zoneinfo import ZoneInfo

from ..config import settings
from ..supabase_client import supabase

TABLES_TO_BACKUP = ["employees", "attendance", "schedule_settings", "notifications"]


def _fetch_table_data(table_name: str) -> list[dict]:
  response = supabase.table(table_name).select("*").execute()
  return response.data or []


def ensure_bucket_exists() -> None:
  bucket = settings.supabase_backup_bucket
  try:
    supabase.storage.get_bucket(bucket)
  except Exception:
    supabase.storage.create_bucket(bucket, {"public": False})


def create_backup_snapshot(source: str = "manual") -> dict:
  ensure_bucket_exists()

  timestamp = datetime.now(ZoneInfo(settings.app_timezone))
  snapshot = {
    "created_at": timestamp.isoformat(),
    "source": source,
    "tables": {table: _fetch_table_data(table) for table in TABLES_TO_BACKUP}
  }

  filename = f"dtr-backup-{timestamp.strftime('%Y%m%d-%H%M%S')}.json"
  content = json.dumps(snapshot, default=str, indent=2).encode("utf-8")

  supabase.storage.from_(settings.supabase_backup_bucket).upload(
    path=filename,
    file=content,
    file_options={"content-type": "application/json", "upsert": "true"}
  )

  try:
    supabase.table("backup_logs").insert({
      "filename": filename,
      "source": source,
      "created_at": timestamp.isoformat()
    }).execute()
  except Exception:
    # Backup log table is optional for minimal setup.
    pass

  return {"filename": filename, "created_at": timestamp.isoformat()}


def list_backups() -> list[dict]:
  ensure_bucket_exists()
  raw_items = supabase.storage.from_(settings.supabase_backup_bucket).list(path="")
  normalized = [
    {
      "name": item.get("name"),
      "updated_at": item.get("updated_at")
    }
    for item in raw_items
    if item.get("name")
  ]
  return sorted(normalized, key=lambda item: item["name"], reverse=True)


def restore_backup_snapshot(filename: str) -> dict:
  file_content = supabase.storage.from_(settings.supabase_backup_bucket).download(path=filename)
  payload = json.loads(file_content.decode("utf-8"))
  table_data = payload.get("tables", {})

  for table_name in ("attendance", "notifications", "schedule_settings", "employees"):
    try:
      supabase.table(table_name).delete().neq("id", 0).execute()
    except Exception:
      pass

  for table_name in ("employees", "schedule_settings", "notifications", "attendance"):
    rows = table_data.get(table_name, [])
    if not rows:
      continue

    try:
      supabase.table(table_name).upsert(rows).execute()
    except Exception:
      supabase.table(table_name).insert(rows).execute()

  return {"restored": filename, "records": {k: len(v) for k, v in table_data.items()}}
