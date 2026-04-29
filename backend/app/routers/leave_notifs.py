from fastapi import APIRouter, HTTPException

from ..schemas import EmployeeLeaveBalancesUpsert, LeaveTypeCreate, LeaveTypeUpdate
from ..services.cache_revision import invalidate_cache_revision
from ..services.realtime import publish_event
from ..services.response_cache import invalidate_cached_values
from ..supabase_client import get_supabase_client

router = APIRouter(prefix="/leave-notifs", tags=["leave-notifs"])


def _normalize_code(value: str) -> str:
  return str(value or "").strip().upper()


def _normalize_text(value: str | None) -> str | None:
  return str(value or "").strip() or None


def _translate_leave_error(error: Exception, action: str) -> HTTPException:
  message = str(error).lower()

  if "duplicate key value violates unique constraint" in message or "leave_types_code_key" in message:
    return HTTPException(status_code=409, detail="A leave type with the same code already exists.")

  if "null value in column" in message or "not-null" in message:
    return HTTPException(status_code=400, detail="All required leave fields must be filled in.")

  return HTTPException(status_code=500, detail=f"Failed to {action} leave data.")


def _load_dashboard_payload(supabase) -> dict:
  employees_response = (
    supabase.table("employees")
    .select("id,name,category,office,employee_no")
    .order("name")
    .execute()
  )
  leave_types_response = (
    supabase.table("leave_types")
    .select("id,code,name,description,active,created_at,updated_at")
    .order("active", desc=True)
    .order("code")
    .execute()
  )
  balances_response = (
    supabase.table("employee_leave_balances")
    .select("id,employee_id,leave_type_id,quantity,created_at,updated_at")
    .order("employee_id")
    .order("leave_type_id")
    .execute()
  )

  return {
    "employees": employees_response.data or [],
    "leave_types": leave_types_response.data or [],
    "balances": balances_response.data or []
  }


@router.get("/dashboard")
def get_leave_dashboard() -> dict:
  supabase = get_supabase_client()
  return _load_dashboard_payload(supabase)


@router.get("/types")
def list_leave_types() -> list[dict]:
  supabase = get_supabase_client()
  response = (
    supabase.table("leave_types")
    .select("id,code,name,description,active,created_at,updated_at")
    .order("active", desc=True)
    .order("code")
    .execute()
  )
  return response.data or []


@router.post("/types")
async def create_leave_type(payload: LeaveTypeCreate) -> dict:
  supabase = get_supabase_client()
  values = {
    "code": _normalize_code(payload.code),
    "name": _normalize_text(payload.name),
    "description": _normalize_text(payload.description),
    "active": bool(payload.active)
  }

  try:
    response = supabase.table("leave_types").insert(values).execute()
  except Exception as error:
    raise _translate_leave_error(error, "create") from error

  if not response.data:
    raise HTTPException(status_code=500, detail="Failed to create leave type.")

  created = response.data[0]
  invalidate_cache_revision()
  invalidate_cached_values()
  await publish_event("leave.type.updated", f"Leave type added: {created['code']} - {created['name']}", created)
  return created


@router.patch("/types/{leave_type_id}")
async def update_leave_type(leave_type_id: int, payload: LeaveTypeUpdate) -> dict:
  supabase = get_supabase_client()
  values = {}

  if payload.code is not None:
    values["code"] = _normalize_code(payload.code)
  if payload.name is not None:
    values["name"] = _normalize_text(payload.name)
  if payload.description is not None:
    values["description"] = _normalize_text(payload.description)
  if payload.active is not None:
    values["active"] = bool(payload.active)

  if not values:
    raise HTTPException(status_code=400, detail="No leave type changes were provided.")

  try:
    response = supabase.table("leave_types").update(values).eq("id", leave_type_id).execute()
  except Exception as error:
    raise _translate_leave_error(error, "update") from error

  if not response.data:
    raise HTTPException(status_code=404, detail="Leave type not found.")

  updated = response.data[0]
  invalidate_cache_revision()
  invalidate_cached_values()
  await publish_event("leave.type.updated", f"Leave type updated: {updated['code']} - {updated['name']}", updated)
  return updated


@router.put("/balances")
async def upsert_employee_leave_balances(payload: EmployeeLeaveBalancesUpsert) -> dict:
  supabase = get_supabase_client()

  employee_response = (
    supabase.table("employees")
    .select("id,name,category,office,employee_no")
    .eq("id", payload.employee_id)
    .limit(1)
    .execute()
  )
  if not employee_response.data:
    raise HTTPException(status_code=404, detail="Employee not found.")

  balances = payload.balances or []
  if not balances:
    return {
      "employee_id": payload.employee_id,
      "saved_count": 0,
      "balances": []
    }

  leave_type_ids = sorted({item.leave_type_id for item in balances})
  leave_types_response = (
    supabase.table("leave_types")
    .select("id")
    .in_("id", leave_type_ids)
    .execute()
  )
  if len(leave_types_response.data or []) != len(leave_type_ids):
    raise HTTPException(status_code=404, detail="One or more leave types were not found.")

  rows = [
    {
      "employee_id": payload.employee_id,
      "leave_type_id": item.leave_type_id,
      "quantity": round(float(item.quantity), 2)
    }
    for item in balances
  ]

  try:
    response = supabase.table("employee_leave_balances").upsert(rows, on_conflict="employee_id,leave_type_id").execute()
  except Exception as error:
    raise HTTPException(status_code=500, detail="Failed to save employee leave balances.") from error

  saved_rows = response.data or rows
  invalidate_cache_revision()
  invalidate_cached_values()

  employee = employee_response.data[0]
  await publish_event(
    "leave.balance.updated",
    f"Leave balances updated for {employee['name']}",
    {"employee_id": employee["id"], "saved_count": len(saved_rows)}
  )

  return {
    "employee_id": employee["id"],
    "saved_count": len(saved_rows),
    "balances": saved_rows
  }