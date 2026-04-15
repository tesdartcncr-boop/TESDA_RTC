from supabase import Client, create_client

from .config import settings

_supabase_client = None


def get_supabase_client() -> Client:
  """Lazy load Supabase client on first use to avoid startup errors."""
  global _supabase_client
  if _supabase_client is None:
    try:
      # Initialize client with anon key first
      _supabase_client = create_client(settings.supabase_url, settings.supabase_anon_key)
      # Set service role key for privileged operations
      _supabase_client.postgrest.auth(settings.supabase_service_role_key)
    except Exception as e:
      print(f"Warning: Supabase client initialization failed: {e}")
      raise
  return _supabase_client


# Global instance: accessed lazily via get_supabase_client()
supabase = None


def init_supabase():
  """Initialize Supabase on app startup."""
  global supabase
  supabase = get_supabase_client()
