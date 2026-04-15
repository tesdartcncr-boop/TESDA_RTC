import asyncio

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_allowed_origins, settings
from .routers import attendance, backups, employees, reports, settings as settings_router
from .services.auth import PROTECTED_PATH_PREFIXES, extract_bearer_token, verify_supabase_access_token
from .services.backup_service import create_backup_snapshot
from .services.realtime import manager, publish_event

app = FastAPI(title="DTR Automation API", version="1.0.0")

app.add_middleware(
  CORSMiddleware,
  allow_origins=get_allowed_origins(),
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

app.include_router(employees.router)
app.include_router(attendance.router)
app.include_router(settings_router.router)
app.include_router(reports.router)
app.include_router(backups.router)

scheduler = BackgroundScheduler(timezone=settings.app_timezone)


@app.middleware("http")
async def require_auth_for_protected_routes(request, call_next):
  if request.method != "OPTIONS" and any(request.url.path.startswith(prefix) for prefix in PROTECTED_PATH_PREFIXES):
    token = extract_bearer_token(request.headers.get("Authorization"))
    try:
      verify_supabase_access_token(token)
    except Exception as error:
      status_code = getattr(error, "status_code", 401)
      detail = getattr(error, "detail", "Unauthorized.")
      return JSONResponse(status_code=status_code, content={"detail": detail})

  return await call_next(request)


def run_automatic_backup() -> None:
  result = create_backup_snapshot(source="automatic")
  try:
    asyncio.run(
      publish_event(
        "backup.created",
        f"Automatic backup created: {result['filename']}",
        result,
      )
    )
  except RuntimeError:
    # If an event loop is already running, skip realtime push but keep backup.
    pass


@app.on_event("startup")
async def startup() -> None:
  if not scheduler.running:
    trigger = CronTrigger.from_crontab(settings.daily_backup_cron)
    scheduler.add_job(
      run_automatic_backup,
      trigger=trigger,
      id="daily_backup",
      replace_existing=True,
    )
    scheduler.start()


@app.on_event("shutdown")
async def shutdown() -> None:
  if scheduler.running:
    scheduler.shutdown(wait=False)


@app.get("/")
def root() -> dict:
  return {"message": "DTR Automation API is running"}


@app.get("/health")
def health() -> dict:
  return {"status": "ok"}


@app.websocket("/ws/updates")
async def websocket_updates(websocket: WebSocket) -> None:
  access_token = websocket.query_params.get("access_token", "")
  try:
    verify_supabase_access_token(access_token)
  except Exception:
    await websocket.close(code=4401)
    return

  await manager.connect(websocket)
  try:
    while True:
      await websocket.receive_text()
  except WebSocketDisconnect:
    manager.disconnect(websocket)
