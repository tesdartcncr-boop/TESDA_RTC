import csv
import io
from datetime import datetime

from openpyxl import Workbook

from ..supabase_client import get_supabase_client


def get_month_range(month: str) -> tuple[str, str]:
  dt = datetime.strptime(month, "%Y-%m")
  start = dt.strftime("%Y-%m-01")

  if dt.month == 12:
    end_dt = dt.replace(year=dt.year + 1, month=1)
  else:
    end_dt = dt.replace(month=dt.month + 1)

  end = (end_dt).strftime("%Y-%m-01")
  return start, end


def get_enriched_attendance(month: str | None = None) -> list[dict]:
  supabase = get_supabase_client()
  attendance_query = supabase.table("attendance").select("*")

  if month:
    start, end = get_month_range(month)
    attendance_query = attendance_query.gte("date", start).lt("date", end)

  attendance_rows = attendance_query.execute().data or []
  employee_rows = supabase.table("employees").select("id,name,category").execute().data or []
  employee_map = {row["id"]: row for row in employee_rows}

  enriched = []
  for row in attendance_rows:
    employee = employee_map.get(row["employee_id"], {})
    merged = {
      **row,
      "employee_name": employee.get("name", "Unknown Employee"),
      "category": employee.get("category", "unknown")
    }
    enriched.append(merged)

  return sorted(enriched, key=lambda item: (item.get("date", ""), item.get("employee_name", "")), reverse=True)


def build_monthly_summary(rows: list[dict]) -> list[dict]:
  summary: dict[tuple[str, str], dict] = {}

  for row in rows:
    key = (row["employee_name"], row["category"])
    if key not in summary:
      summary[key] = {
        "employee_name": row["employee_name"],
        "category": row["category"],
        "days_worked": 0,
        "total_late_minutes": 0,
        "total_undertime_minutes": 0,
        "total_overtime_minutes": 0
      }

    summary[key]["days_worked"] += 1
    summary[key]["total_late_minutes"] += int(row.get("late_minutes") or 0)
    summary[key]["total_undertime_minutes"] += int(row.get("undertime_minutes") or 0)
    summary[key]["total_overtime_minutes"] += int(row.get("overtime_minutes") or 0)

  return sorted(summary.values(), key=lambda item: item["employee_name"])


def build_late_report(rows: list[dict]) -> list[dict]:
  return [
    {
      "date": row.get("date"),
      "employee_name": row.get("employee_name"),
      "category": row.get("category"),
      "late_minutes": row.get("late_minutes", 0)
    }
    for row in rows
    if int(row.get("late_minutes") or 0) > 0
  ]


def build_overtime_report(rows: list[dict]) -> list[dict]:
  return [
    {
      "date": row.get("date"),
      "employee_name": row.get("employee_name"),
      "category": row.get("category"),
      "overtime_minutes": row.get("overtime_minutes", 0)
    }
    for row in rows
    if int(row.get("overtime_minutes") or 0) > 0
  ]


def export_csv(rows: list[dict]) -> bytes:
  output = io.StringIO()
  writer = csv.writer(output)
  writer.writerow([
    "Date",
    "Employee",
    "Category",
    "Time In",
    "Time Out",
    "Late",
    "Undertime",
    "Leave",
    "Schedule"
  ])

  for row in rows:
    writer.writerow([
      row.get("date"),
      row.get("employee_name"),
      row.get("category"),
      row.get("time_in"),
      row.get("time_out"),
      row.get("late_minutes"),
      row.get("undertime_minutes"),
      row.get("leave_type"),
      row.get("schedule_type")
    ])

  return output.getvalue().encode("utf-8")


def export_xlsx(rows: list[dict]) -> bytes:
  workbook = Workbook()
  sheet = workbook.active
  sheet.title = "Attendance Report"

  sheet.append([
    "Date",
    "Employee",
    "Category",
    "Time In",
    "Time Out",
    "Late",
    "Undertime",
    "Leave",
    "Schedule"
  ])

  for row in rows:
    sheet.append([
      row.get("date"),
      row.get("employee_name"),
      row.get("category"),
      row.get("time_in"),
      row.get("time_out"),
      row.get("late_minutes"),
      row.get("undertime_minutes"),
      row.get("leave_type"),
      row.get("schedule_type")
    ])

  binary = io.BytesIO()
  workbook.save(binary)
  return binary.getvalue()
