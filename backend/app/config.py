from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
  supabase_url: str
  supabase_service_role_key: str
  supabase_anon_key: str = ""
  supabase_backup_bucket: str = "dtr-backups"
  supabase_auth_allowed_emails: str = "tesda.mpltp.tapat@gmail.com,mssabatin@tesda.gov.ph"
  allowed_origins: str = "http://localhost:5173,http://localhost:5174"
  app_timezone: str = "Asia/Manila"
  daily_backup_cron: str = "0 23 * * *"
  # Email configuration (Gmail SMTP)
  email_sender: str = "tesda.mpltp.tapat@gmail.com"
  mail_sender: str = ""
  email_app_password: str = ""

  model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()


def get_allowed_origins() -> list[str]:
  return [origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()]


def get_allowed_auth_emails() -> list[str]:
  try:
    from .supabase_client import get_supabase_client

    supabase = get_supabase_client()
    response = supabase.table("auth_allowed_emails").select("email").eq("enabled", True).order("email").execute()
    return [row["email"].strip().lower() for row in (response.data or []) if row.get("email")]
  except Exception:
    # Fall back to the env list if the table is missing or unavailable.
    pass

  return [email.strip().lower() for email in settings.supabase_auth_allowed_emails.split(",") if email.strip()]
