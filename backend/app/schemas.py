from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


class EmployeeNameParts(BaseModel):
  first_name: str = Field(min_length=1, max_length=120)
  second_name: str | None = Field(default=None, max_length=120)
  last_name: str = Field(min_length=1, max_length=120)
  extension: str | None = Field(default=None, max_length=20)


class EmployeeCreate(EmployeeNameParts):
  name: str = Field(min_length=2, max_length=120)
  category: str = Field(pattern="^(regular|jo)$")
  employee_password: str = Field(min_length=4, max_length=120)


class EmployeeUpdate(EmployeeNameParts):
  name: str = Field(min_length=2, max_length=120)
  category: str = Field(pattern="^(regular|jo)$")
  employee_password: str | None = Field(default=None, min_length=4, max_length=120)


class ClockRequest(BaseModel):
  employee_id: int
  date: Optional[date] = None
  schedule_type: str = "A"
  leave_type: Optional[str] = None
  employee_password: str = Field(min_length=1, max_length=120)


class AttendanceUpdate(BaseModel):
  date: Optional[date] = None
  time_in: Optional[str] = None
  time_out: Optional[str] = None
  leave_type: Optional[str] = None
  schedule_type: Optional[str] = None


class ScheduleThresholdUpdate(BaseModel):
  date: date
  late_threshold: str = Field(pattern="^([01]\\d|2[0-3]):[0-5]\\d$")


class RestoreBackupRequest(BaseModel):
  filename: str
