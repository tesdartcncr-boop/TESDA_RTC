from fastapi import APIRouter, HTTPException

from ..schemas import EmployeeCreate, EmployeeUpdate
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
  await publish_event("employee.updated", f"Employee updated: {updated['name']}", updated)
  return updated


@router.delete("/{employee_id}")
async def delete_employee(employee_id: int) -> dict:
  supabase = get_supabase_client()
  existing = supabase.table("employees").select("*").eq("id", employee_id).limit(1).execute()
  if not existing.data:
    raise HTTPException(status_code=404, detail="Employee not found.")

  supabase.table("employees").delete().eq("id", employee_id).execute()
  await publish_event("employee.deleted", f"Employee deleted: {existing.data[0]['name']}", {"id": employee_id})
  return {"deleted": employee_id}
