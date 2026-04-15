from supabase import Client, create_client

from .config import settings

_supabase_client = None


def get_supabase_client() -> Client:
  """Lazy load Supabase client on first use to avoid startup errors."""
  global _supabase_client
  if _supabase_client is None:
    try:
      if not settings.supabase_url or not settings.supabase_service_role_key:
        raise ValueError(f"Missing Supabase credentials: URL={bool(settings.supabase_url)}, SERVICE_ROLE_KEY={bool(settings.supabase_service_role_key)}")
      # Initialize client with service role key (JWT format that Python client accepts)
      _supabase_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    except Exception as e:
      print(f"ERROR: Supabase client initialization failed: {e}")
      print(f"  SUPABASE_URL: {settings.supabase_url}")
      print(f"  SUPABASE_SERVICE_ROLE_KEY: {settings.supabase_service_role_key[:20]}..." if settings.supabase_service_role_key else "  SUPABASE_SERVICE_ROLE_KEY: NOT SET")
      raise
  return _supabase_client


# Global instance: accessed lazily via get_supabase_client()
supabase = None


def init_supabase():
  """Initialize Supabase on app startup. Non-blocking to prevent startup failures."""
  global supabase
  try:
    supabase = get_supabase_client()
    print("✓ Supabase client initialized successfully")
  except Exception as e:
    print(f"⚠ WARNING: Supabase initialization failed: {e}")
    print("  App will continue but Supabase operations will fail.")
    print("  Check environment variables: SUPABASE_URL, SUPABASE_ANON_KEY")
