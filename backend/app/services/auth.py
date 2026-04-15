import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import HTTPException, Request as FastAPIRequest

from ..config import get_allowed_auth_emails, settings


PROTECTED_PATH_PREFIXES = ("/attendance", "/employees", "/settings", "/reports", "/backups")


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
  if allowed_emails and email not in allowed_emails:
    raise HTTPException(status_code=403, detail="This account is not allowed to access the portals.")

  return payload


def require_authenticated_user(request: FastAPIRequest) -> dict:
  access_token = extract_bearer_token(request.headers.get("Authorization"))
  return verify_supabase_access_token(access_token)