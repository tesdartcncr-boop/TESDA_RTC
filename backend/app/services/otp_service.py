import random
import string
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ..config import settings
from ..supabase_client import get_supabase_client


def generate_otp_code(length: int = 6) -> str:
  """Generate a random 6-digit OTP code."""
  return ''.join(random.choices(string.digits, k=length))


def create_otp(email: str) -> str:
  """Create and store an OTP for the given email. Returns the OTP code."""
  supabase = get_supabase_client()
  
  otp_code = generate_otp_code()
  expires_at = datetime.now(ZoneInfo(settings.app_timezone)) + timedelta(minutes=10)
  
  response = supabase.table("otp_tokens").insert({
    "email": email.lower(),
    "otp_code": otp_code,
    "expires_at": expires_at.isoformat(),
    "used": False
  }).execute()
  
  if not response.data:
    raise Exception("Failed to create OTP token in database.")
  
  return otp_code


def delete_otp(email: str, otp_code: str) -> None:
  """Delete a stored OTP for the given email and code."""
  supabase = get_supabase_client()

  supabase.table("otp_tokens").delete().eq("email", email.lower()).eq("otp_code", otp_code).eq("used", False).execute()


def verify_otp(email: str, otp_code: str) -> bool:
  """Verify the OTP code for the given email. Returns True if valid, False otherwise."""
  supabase = get_supabase_client()
  
  email = email.lower()
  now = datetime.now(ZoneInfo(settings.app_timezone)).isoformat()
  
  response = supabase.table("otp_tokens").select("*").eq("email", email).eq("otp_code", otp_code).eq("used", False).gt("expires_at", now).limit(1).execute()
  
  if not response.data:
    return False
  
  # Mark OTP as used
  otp_id = response.data[0]["id"]
  supabase.table("otp_tokens").update({"used": True}).eq("id", otp_id).execute()
  
  return True


def cleanup_expired_otps() -> None:
  """Delete expired OTP tokens. Can be called periodically."""
  supabase = get_supabase_client()
  now = datetime.now(ZoneInfo(settings.app_timezone)).isoformat()
  
  supabase.table("otp_tokens").delete().lt("expires_at", now).execute()
