from fastapi import APIRouter, HTTPException

from ..schemas import EmployeeCreate, EmployeeUpdate
from ..services.realtime import publish_event
from ..supabase_client import supabase

router = APIRouter(prefix="/employees", tags=["employees"])


@router.get("")
def list_employees(category: str = "regular") -> list[dict]:
  query = supabase.table("employees").select("*").order("name")

  if category in {"regular", "jo"}:
    query = query.eq("category", category)

  response = query.execute()
  return response.data or []


@router.post("")
async def create_employee(payload: EmployeeCreate) -> dict:
  response = supabase.table("employees").insert(payload.model_dump()).execute()
  if not response.data:
    raise HTTPException(status_code=500, detail="Failed to create employee.")

  created = response.data[0]
  await publish_event("employee.created", f"Employee added: {created['name']}", created)
  return created


@router.put("/{employee_id}")
async def update_employee(employee_id: int, payload: EmployeeUpdate) -> dict:
  response = supabase.table("employees").update(payload.model_dump()).eq("id", employee_id).execute()
  if not response.data:
    raise HTTPException(status_code=404, detail="Employee not found.")

  updated = response.data[0]
  await publish_event("employee.updated", f"Employee updated: {updated['name']}", updated)
  return updated


@router.delete("/{employee_id}")
async def delete_employee(employee_id: int) -> dict:
  existing = supabase.table("employees").select("*").eq("id", employee_id).limit(1).execute()
  if not existing.data:
    raise HTTPException(status_code=404, detail="Employee not found.")

  supabase.table("employees").delete().eq("id", employee_id).execute()
  await publish_event("employee.deleted", f"Employee deleted: {existing.data[0]['name']}", {"id": employee_id})
  return {"deleted": employee_id}
