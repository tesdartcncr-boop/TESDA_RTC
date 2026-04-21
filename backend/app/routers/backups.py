from fastapi import APIRouter

from ..schemas import RestoreBackupRequest
from ..services.backup_service import create_backup_snapshot, list_backups, restore_backup_snapshot
from ..services.cache_revision import invalidate_cache_revision
from ..services.realtime import publish_event
from ..services.response_cache import invalidate_cached_values

router = APIRouter(prefix="/backups", tags=["backups"])


@router.post("/manual")
async def manual_backup() -> dict:
  result = create_backup_snapshot(source="manual")
  await publish_event("backup.created", f"Manual backup created: {result['filename']}", result)
  return result


@router.get("")
def get_backups() -> list[dict]:
  return list_backups()


@router.post("/restore")
async def restore_backup(payload: RestoreBackupRequest) -> dict:
  result = restore_backup_snapshot(payload.filename)
  invalidate_cache_revision()
  invalidate_cached_values()
  await publish_event("backup.restored", f"Backup restored: {payload.filename}", result)
  return result
