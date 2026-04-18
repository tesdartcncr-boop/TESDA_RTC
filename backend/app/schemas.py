from datetime import date as Date
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


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
  date: Optional[Date] = None
  schedule_type: str = "A"
  leave_type: Optional[str] = None
  employee_password: str = Field(min_length=1, max_length=120)


class AttendanceUpdate(BaseModel):
  date: Optional[Date] = None
  time_in: Optional[str] = None
  time_out: Optional[str] = None
  leave_type: Optional[str] = None
  schedule_type: Optional[str] = None


class MasterSheetAttendanceUpsert(BaseModel):
  employee_id: int
  date: Date
  time_in: Optional[str] = None
  time_out: Optional[str] = None
  leave_type: Optional[str] = None
  schedule_type: str = "A"


class ScheduleThresholdUpdate(BaseModel):
  date: Date
  schedule_type: Optional[str] = Field(default=None, pattern="^(A|B)$")
  late_threshold: str = Field(pattern="^([01]\\d|2[0-3]):[0-5]\\d$")


class AuthorizedEmailCreate(BaseModel):
  email: EmailStr


class AuthorizedEmailStatusUpdate(BaseModel):
  enabled: bool


class RestoreBackupRequest(BaseModel):
  filename: str
