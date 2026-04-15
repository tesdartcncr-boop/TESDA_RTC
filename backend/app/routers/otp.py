from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr

from ..config import get_allowed_auth_emails
from ..services.email_service import send_otp_email
from ..services.otp_service import create_otp, verify_otp

router = APIRouter(prefix="/auth", tags=["auth"])


class OTPRequestPayload(BaseModel):
  email: EmailStr


class OTPVerifyPayload(BaseModel):
  email: EmailStr
  otp_code: str


@router.post("/otp/request")
async def request_otp(payload: OTPRequestPayload) -> dict:
  """
  Request an OTP to be sent to the provided email.
  Email must be in the allowed list.
  """
  email = payload.email.lower()
  allowed_emails = get_allowed_auth_emails()
  
  if email not in allowed_emails:
    raise HTTPException(status_code=403, detail="Email not authorized for OTP login.")
  
  try:
    otp_code = create_otp(email)
    email_sent = send_otp_email(email, otp_code)
    
    if not email_sent:
      raise HTTPException(status_code=500, detail="Failed to send OTP email. Please try again.")
    
    return {
      "message": "OTP sent successfully",
      "email": email,
      "expires_in_minutes": 10
    }
  except Exception as e:
    raise HTTPException(status_code=500, detail=f"Error requesting OTP: {str(e)}")


@router.post("/otp/verify")
async def verify_otp_endpoint(payload: OTPVerifyPayload) -> dict:
  """
  Verify the OTP code for the given email.
  If valid, returns success and user can proceed with Supabase auth.
  """
  email = payload.email.lower()
  otp_code = payload.otp_code.strip()
  
  allowed_emails = get_allowed_auth_emails()
  if email not in allowed_emails:
    raise HTTPException(status_code=403, detail="Email not authorized.")
  
  if not otp_code:
    raise HTTPException(status_code=400, detail="OTP code is required.")
  
  if verify_otp(email, otp_code):
    return {
      "message": "OTP verified successfully",
      "verified": True,
      "email": email
    }
  else:
    raise HTTPException(status_code=401, detail="Invalid or expired OTP code.")
