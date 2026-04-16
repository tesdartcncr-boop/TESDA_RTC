import csv
import io
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from ..supabase_client import get_supabase_client
from .time_utils import is_leave_code


def format_duration(minutes: int | None) -> str:
  total_minutes = max(int(minutes or 0), 0)
  hours = total_minutes // 60
  remaining_minutes = total_minutes % 60
  return f"{hours}:{remaining_minutes:02d}"


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
    "Late (h:mm)",
    "Undertime (h:mm)",
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
      format_duration(row.get("late_minutes")),
      format_duration(row.get("undertime_minutes")),
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
    "Late (h:mm)",
    "Undertime (h:mm)",
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
      format_duration(row.get("late_minutes")),
      format_duration(row.get("undertime_minutes")),
      row.get("leave_type"),
      row.get("schedule_type")
    ])

  binary = io.BytesIO()
  workbook.save(binary)
  return binary.getvalue()


def _display_master_sheet_value(row: dict, field: str) -> str:
  leave_type = (row.get("leave_type") or "").strip().upper() or None
  value = row.get(field)

  if field == "time_in":
    if leave_type:
      return leave_type
    if is_leave_code(value):
      return value

  if field == "time_out" and is_leave_code(value):
    return value

  return value or ""


def export_master_sheet_xlsx(sheet_data: dict) -> bytes:
  workbook = Workbook()
  sheet = workbook.active
  sheet.title = "Master Sheet"
  sheet.sheet_view.showGridLines = False
  sheet.page_setup.orientation = "landscape"
  sheet.page_setup.fitToWidth = 1
  sheet.page_setup.fitToHeight = 0

  employees = sheet_data.get("employees") or []
  dates = sheet_data.get("dates") or []
  records = sheet_data.get("records") or []
  title = sheet_data.get("title") or "Master Record Sheet"

  record_map = {
    (row.get("date"), row.get("employee_id")): row
    for row in records
    if row.get("date") is not None and row.get("employee_id") is not None
  }

  total_columns = max(2 + len(employees) * 2, 2)
  sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=total_columns)
  sheet.cell(1, 1, title)

  dark_fill = PatternFill("solid", fgColor="0F6B6B")
  header_fill = PatternFill("solid", fgColor="DCEFD9")
  subheader_fill = PatternFill("solid", fgColor="ECF6E7")
  date_fill = PatternFill("solid", fgColor="F6E3D2")
  day_fill = PatternFill("solid", fgColor="EFEFEF")
  weekend_fill = PatternFill("solid", fgColor="D7D7D7")
  monday_fill = PatternFill("solid", fgColor="F5C148")
  white_fill = PatternFill("solid", fgColor="FFFFFF")
  thin_side = Side(style="thin", color="7F8C91")
  thin_border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

  title_cell = sheet.cell(1, 1)
  title_cell.fill = dark_fill
  title_cell.font = Font(color="FFFFFF", bold=True, size=14)
  title_cell.alignment = Alignment(horizontal="left", vertical="center")
  sheet.row_dimensions[1].height = 24
  sheet.row_dimensions[2].height = 8

  sheet.merge_cells(start_row=3, start_column=1, end_row=4, end_column=1)
  sheet.merge_cells(start_row=3, start_column=2, end_row=4, end_column=2)
  sheet.cell(3, 1, "DATE")
  sheet.cell(3, 2, "DAY")

  sheet.cell(3, 1).fill = date_fill
  sheet.cell(3, 2).fill = day_fill
  sheet.cell(3, 1).font = Font(bold=True)
  sheet.cell(3, 2).font = Font(bold=True)
  sheet.cell(3, 1).alignment = Alignment(horizontal="center", vertical="center")
  sheet.cell(3, 2).alignment = Alignment(horizontal="center", vertical="center")
  sheet.cell(4, 1).fill = date_fill
  sheet.cell(4, 2).fill = day_fill

  for index, employee in enumerate(employees):
    start_column = 3 + (index * 2)
    surname = (employee.get("surname") or employee.get("last_name") or employee.get("name") or "").strip().upper()

    sheet.merge_cells(start_row=3, start_column=start_column, end_row=3, end_column=start_column + 1)
    sheet.cell(3, start_column, surname)
    sheet.cell(3, start_column).fill = header_fill
    sheet.cell(3, start_column).font = Font(bold=True)
    sheet.cell(3, start_column).alignment = Alignment(horizontal="center", vertical="center")

    sheet.cell(4, start_column, "IN")
    sheet.cell(4, start_column + 1, "OUT")
    sheet.cell(4, start_column).fill = subheader_fill
    sheet.cell(4, start_column + 1).fill = subheader_fill
    sheet.cell(4, start_column).font = Font(bold=True)
    sheet.cell(4, start_column + 1).font = Font(bold=True)
    sheet.cell(4, start_column).alignment = Alignment(horizontal="center", vertical="center")
    sheet.cell(4, start_column + 1).alignment = Alignment(horizontal="center", vertical="center")

    sheet.column_dimensions[get_column_letter(start_column)].width = 10
    sheet.column_dimensions[get_column_letter(start_column + 1)].width = 10

  sheet.column_dimensions["A"].width = 12
  sheet.column_dimensions["B"].width = 14

  sheet.freeze_panes = "C5"

  for row_index, date_info in enumerate(dates, start=5):
    row_date = date_info.get("date")
    weekday = date_info.get("weekday") or ""
    is_weekend = bool(date_info.get("is_weekend"))
    is_monday = bool(date_info.get("is_monday"))
    row_fill = weekend_fill if is_weekend else monday_fill if is_monday else white_fill

    sheet.cell(row_index, 1, date_info.get("label") or row_date)
    sheet.cell(row_index, 2, weekday)
    sheet.cell(row_index, 1).fill = row_fill
    sheet.cell(row_index, 2).fill = row_fill
    sheet.cell(row_index, 1).font = Font(bold=True if is_weekend or is_monday else False)
    sheet.cell(row_index, 2).font = Font(bold=True if is_weekend or is_monday else False)
    sheet.cell(row_index, 1).alignment = Alignment(horizontal="center", vertical="center")
    sheet.cell(row_index, 2).alignment = Alignment(horizontal="left", vertical="center")

    for index, employee in enumerate(employees):
      start_column = 3 + (index * 2)
      record = record_map.get((row_date, employee.get("id")), {})

      time_in_cell = sheet.cell(row_index, start_column, _display_master_sheet_value(record, "time_in"))
      time_out_cell = sheet.cell(row_index, start_column + 1, _display_master_sheet_value(record, "time_out"))

      time_in_cell.fill = white_fill
      time_out_cell.fill = white_fill
      time_in_cell.alignment = Alignment(horizontal="center", vertical="center")
      time_out_cell.alignment = Alignment(horizontal="center", vertical="center")

  for row in sheet.iter_rows(min_row=1, max_row=4 + len(dates), min_col=1, max_col=total_columns):
    for cell in row:
      cell.border = thin_border

  binary = io.BytesIO()
  workbook.save(binary)
  return binary.getvalue()
