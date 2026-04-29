from fastapi import APIRouter, HTTPException

from ..schemas import EmployeeProfileLookupRequest
from ..services.passwords import verify_employee_password
from ..supabase_client import get_supabase_client

router = APIRouter(prefix="/profile", tags=["profile"])


def _load_active_leave_types(supabase) -> list[dict]:
  response = (
    supabase.table("leave_types")
    .select("id,code,name,description,active")
    .eq("active", True)
    .order("code")
    .execute()
  )
  return response.data or []


@router.get("/employees")
def list_profile_employees() -> list[dict]:
  supabase = get_supabase_client()
  response = (
    supabase.table("employees")
    .select("id,name,category,office,employee_no")
    .order("name")
    .execute()
  )
  return response.data or []


@router.get("/leave-types")
def list_profile_leave_types() -> list[dict]:
  supabase = get_supabase_client()
  return _load_active_leave_types(supabase)


@router.post("/lookup")
def lookup_employee_profile(payload: EmployeeProfileLookupRequest) -> dict:
  supabase = get_supabase_client()
  employee_response = (
    supabase.table("employees")
    .select("id,name,category,office,employee_no,employee_password_hash")
    .eq("id", payload.employee_id)
    .limit(1)
    .execute()
  )

  if not employee_response.data:
    raise HTTPException(status_code=404, detail="Employee not found.")

  employee = employee_response.data[0]
  if not employee.get("employee_password_hash"):
    raise HTTPException(status_code=400, detail="Employee password is not set.")

  if not verify_employee_password(payload.employee_password, employee.get("employee_password_hash")):
    raise HTTPException(status_code=401, detail="Invalid employee password.")

  leave_types = _load_active_leave_types(supabase)
  balances_response = (
    supabase.table("employee_leave_balances")
    .select("leave_type_id,quantity")
    .eq("employee_id", employee["id"])
    .execute()
  )
  balances_by_type_id = {
    int(row["leave_type_id"]): row.get("quantity", 0)
    for row in (balances_response.data or [])
  }

  return {
    "employee": {
      "id": employee["id"],
      "name": employee["name"],
      "category": employee["category"],
      "office": employee.get("office"),
      "employee_no": employee.get("employee_no")
    },
    "leave_types": leave_types,
    "balances": [
      {
        "leave_type_id": leave_type["id"],
        "code": leave_type["code"],
        "name": leave_type["name"],
        "description": leave_type.get("description"),
        "quantity": float(balances_by_type_id.get(int(leave_type["id"]), 0) or 0)
      }
      for leave_type in leave_types
    ]
  }