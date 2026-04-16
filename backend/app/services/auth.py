import base64
import hashlib
import hmac
import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import HTTPException, Request as FastAPIRequest

from ..config import get_allowed_auth_emails, settings


PROTECTED_PATH_PREFIXES = ("/attendance", "/employees", "/settings", "/reports", "/backups")


def _portal_secret() -> bytes:
  return settings.supabase_service_role_key.encode("utf-8")


def _base64url_encode(data: bytes) -> str:
  return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _base64url_decode(value: str) -> bytes:
  padding = "=" * (-len(value) % 4)
  return base64.urlsafe_b64decode(value + padding)


def create_portal_session(email: str) -> dict:
  now = int(time.time())
  normalized_email = email.strip().lower()
  header = {"alg": "HS256", "typ": "JWT"}
  payload = {
    "email": normalized_email,
    "iat": now,
    "scope": "portal",
  }
  signing_input = f"{_base64url_encode(json.dumps(header, separators=(',', ':')).encode('utf-8'))}.{_base64url_encode(json.dumps(payload, separators=(',', ':')).encode('utf-8'))}"
  signature = hmac.new(_portal_secret(), signing_input.encode("utf-8"), hashlib.sha256).digest()

  return {
    "access_token": f"{signing_input}.{_base64url_encode(signature)}",
    "token_type": "bearer",
    "email": normalized_email,
    "expires_at": None,
  }


def verify_portal_session(access_token: str) -> dict:
  parts = access_token.split(".")
  if len(parts) != 3:
    raise HTTPException(status_code=401, detail="Login expired. Please sign in again.")

  signing_input = f"{parts[0]}.{parts[1]}"
  expected_signature = _base64url_encode(hmac.new(_portal_secret(), signing_input.encode("utf-8"), hashlib.sha256).digest())
  if not hmac.compare_digest(expected_signature, parts[2]):
    raise HTTPException(status_code=401, detail="Login expired. Please sign in again.")

  try:
    payload = json.loads(_base64url_decode(parts[1]).decode("utf-8"))
  except Exception as error:
    raise HTTPException(status_code=401, detail="Login expired. Please sign in again.") from error

  email = (payload.get("email") or "").strip().lower()
  if not email:
    raise HTTPException(status_code=401, detail="Login expired. Please sign in again.")

  allowed_emails = get_allowed_auth_emails()
  if email not in allowed_emails:
    raise HTTPException(status_code=403, detail="This account is not allowed to access the portals.")

  return payload


def extract_bearer_token(authorization_header: str | None) -> str:
  if not authorization_header:
    return ""

  scheme, _, token = authorization_header.partition(" ")
  if scheme.lower() != "bearer" or not token.strip():
    return ""

  return token.strip()


def _auth_headers(access_token: str) -> dict[str, str]:
  api_key = settings.supabase_anon_key or settings.supabase_service_role_key
  return {
    "Authorization": f"Bearer {access_token}",
    "apikey": api_key,
  }


def verify_supabase_access_token(access_token: str) -> dict:
  if not access_token:
    raise HTTPException(status_code=401, detail="Missing access token.")

  try:
    return verify_portal_session(access_token)
  except HTTPException as error:
    if error.status_code == 403:
      raise

  auth_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/user"
  request = Request(auth_url, headers=_auth_headers(access_token), method="GET")

  try:
    with urlopen(request, timeout=10) as response:
      payload = json.loads(response.read().decode("utf-8"))
  except HTTPError as error:
    if error.code in {401, 403}:
      raise HTTPException(status_code=401, detail="Login expired. Please sign in again.") from error
    raise HTTPException(status_code=502, detail="Unable to verify the login session.") from error
  except URLError as error:
    raise HTTPException(status_code=502, detail="Unable to contact Supabase Auth.") from error

  email = (payload.get("email") or "").strip().lower()
  allowed_emails = get_allowed_auth_emails()
  if email not in allowed_emails:
    raise HTTPException(status_code=403, detail="This account is not allowed to access the portals.")

  return payload


def require_authenticated_user(request: FastAPIRequest) -> dict:
  access_token = extract_bearer_token(request.headers.get("Authorization"))
  return verify_supabase_access_token(access_token)