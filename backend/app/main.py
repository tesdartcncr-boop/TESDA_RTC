import asyncio

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_allowed_origins, settings
from .routers import attendance, backups, employees, otp, reports, settings as settings_router
from .services.auth import PROTECTED_PATH_PREFIXES, extract_bearer_token, verify_supabase_access_token
from .services.backup_service import create_backup_snapshot
from .services.realtime import manager, publish_event
from .supabase_client import init_supabase

api = FastAPI(title="DTR Automation API", version="1.0.0")

api.include_router(employees.router)
api.include_router(attendance.router)
api.include_router(settings_router.router)
api.include_router(reports.router)
api.include_router(backups.router)
api.include_router(otp.router)

scheduler = BackgroundScheduler(timezone=settings.app_timezone)


@api.middleware("http")
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


app = CORSMiddleware(
  api,
  allow_origins=get_allowed_origins(),
  allow_origin_regex=r"^(https://.*\.onrender\.com|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)


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


@api.on_event("startup")
async def startup() -> None:
  # Initialize Supabase client on app startup
  init_supabase()
  
  if not scheduler.running:
    trigger = CronTrigger.from_crontab(settings.daily_backup_cron)
    scheduler.add_job(
      run_automatic_backup,
      trigger=trigger,
      id="daily_backup",
      replace_existing=True,
    )
    scheduler.start()


@api.on_event("shutdown")
async def shutdown() -> None:
  if scheduler.running:
    scheduler.shutdown(wait=False)


@api.get("/")
def root() -> dict:
  return {"message": "DTR Automation API is running"}


@api.get("/health")
def health() -> dict:
  return {"status": "ok"}


@api.websocket("/ws/updates")
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
