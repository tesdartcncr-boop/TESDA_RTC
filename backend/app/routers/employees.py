from fastapi import APIRouter, HTTPException

from ..schemas import EmployeeCreate, EmployeeUpdate
from ..services.cache_revision import invalidate_cache_revision
from ..services.passwords import hash_employee_password
from ..services.realtime import publish_event
from ..supabase_client import get_supabase_client

router = APIRouter(prefix="/employees", tags=["employees"])


def translate_employee_error(error: Exception, action: str) -> HTTPException:
  message = str(error).lower()

  if "duplicate key value violates unique constraint" in message or "employees_name_category_uq" in message:
    return HTTPException(status_code=409, detail="An employee with the same full name already exists in this category.")

  if "null value in column" in message or "not-null" in message:
    return HTTPException(status_code=400, detail="All required employee fields must be filled in.")

  return HTTPException(status_code=500, detail=f"Failed to {action} employee.")


def _delete_employee_data(supabase, employee_id: int) -> None:
  try:
    supabase.rpc("delete_employee_with_attendance", {"target_employee_id": employee_id}).execute()
    return
  except Exception:
    pass

  supabase.table("attendance").delete().eq("employee_id", employee_id).execute()
  supabase.table("employees").delete().eq("id", employee_id).execute()


@router.get("")
def list_employees(category: str = "regular") -> list[dict]:
  supabase = get_supabase_client()
  query = supabase.table("employees").select("id,first_name,second_name,last_name,extension,name,category,created_at").order("name")

  if category in {"regular", "jo"}:
    query = query.eq("category", category)

  response = query.execute()
  return response.data or []


@router.post("")
async def create_employee(payload: EmployeeCreate) -> dict:
  if not payload.employee_password.strip():
    raise HTTPException(status_code=400, detail="Employee password is required.")

  supabase = get_supabase_client()
  values = payload.model_dump(exclude={"employee_password"})
  values["employee_password_hash"] = hash_employee_password(payload.employee_password)

  try:
    response = supabase.table("employees").insert(values).execute()
  except Exception as error:
    raise translate_employee_error(error, "create") from error

  if not response.data:
    raise HTTPException(status_code=500, detail="Failed to create employee.")

  created = {key: value for key, value in response.data[0].items() if key != "employee_password_hash"}
  invalidate_cache_revision()
  await publish_event("employee.created", f"Employee added: {created['name']}", created)
  return created


@router.put("/{employee_id}")
async def update_employee(employee_id: int, payload: EmployeeUpdate) -> dict:
  supabase = get_supabase_client()
  values = payload.model_dump(exclude={"employee_password"})
  if payload.employee_password and payload.employee_password.strip():
    values["employee_password_hash"] = hash_employee_password(payload.employee_password)

  try:
    response = supabase.table("employees").update(values).eq("id", employee_id).execute()
  except Exception as error:
    raise translate_employee_error(error, "update") from error

  if not response.data:
    raise HTTPException(status_code=404, detail="Employee not found.")

  updated = {key: value for key, value in response.data[0].items() if key != "employee_password_hash"}
  invalidate_cache_revision()
  await publish_event("employee.updated", f"Employee updated: {updated['name']}", updated)
  return updated


@router.delete("/{employee_id}")
async def delete_employee(employee_id: int) -> dict:
  supabase = get_supabase_client()
  existing = supabase.table("employees").select("*").eq("id", employee_id).limit(1).execute()
  if not existing.data:
    raise HTTPException(status_code=404, detail="Employee not found.")

  _delete_employee_data(supabase, employee_id)

  remaining_employee = supabase.table("employees").select("id").eq("id", employee_id).limit(1).execute()
  remaining_attendance = supabase.table("attendance").select("id").eq("employee_id", employee_id).limit(1).execute()
  if remaining_employee.data or remaining_attendance.data:
    raise HTTPException(status_code=500, detail="Failed to delete all employee data.")

  invalidate_cache_revision()
  await publish_event("employee.deleted", f"Employee deleted: {existing.data[0]['name']}", {"id": employee_id})
  return {"deleted": employee_id}
