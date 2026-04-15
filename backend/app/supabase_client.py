from supabase import Client, create_client

from .config import settings

_supabase_client = None


def get_supabase_client() -> Client:
  """Lazy load Supabase client on first use to avoid startup errors."""
  global _supabase_client
  if _supabase_client is None:
    try:
      if not settings.supabase_url or not settings.supabase_anon_key:
        raise ValueError(f"Missing Supabase credentials: URL={bool(settings.supabase_url)}, ANON_KEY={bool(settings.supabase_anon_key)}")
      # Initialize client with anon key first
      _supabase_client = create_client(settings.supabase_url, settings.supabase_anon_key)
      # Set service role key for privileged operations
      _supabase_client.postgrest.auth(settings.supabase_service_role_key)
    except Exception as e:
      print(f"ERROR: Supabase client initialization failed: {e}")
      print(f"  SUPABASE_URL: {settings.supabase_url}")
      print(f"  SUPABASE_ANON_KEY: {settings.supabase_anon_key[:20]}..." if settings.supabase_anon_key else "  SUPABASE_ANON_KEY: NOT SET")
      raise
  return _supabase_client


# Global instance: accessed lazily via get_supabase_client()
supabase = None


def init_supabase():
  """Initialize Supabase on app startup."""
  global supabase
  supabase = get_supabase_client()
