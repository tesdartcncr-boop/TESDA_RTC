from supabase import Client, create_client

from .config import settings


def get_supabase_client() -> Client:
  # Initialize client with anon key first
  client = create_client(settings.supabase_url, settings.supabase_anon_key)
  # Set service role key for privileged operations
  client.postgrest.auth(settings.supabase_service_role_key)
  return client


supabase = get_supabase_client()
