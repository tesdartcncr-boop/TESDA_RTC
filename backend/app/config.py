from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
  supabase_url: str
  supabase_service_role_key: str
  supabase_anon_key: str = ""
  supabase_backup_bucket: str = "dtr-backups"
  allowed_origins: str = "http://localhost:5173,http://localhost:5174"
  app_timezone: str = "Asia/Manila"
  daily_backup_cron: str = "0 23 * * *"

  model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()


def get_allowed_origins() -> list[str]:
  return [origin.strip() for origin in settings.allowed_origins.split(",") if origin.strip()]
