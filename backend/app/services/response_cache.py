from __future__ import annotations

import json
from copy import deepcopy
from threading import Lock
from time import monotonic
from typing import Any

from ..config import settings

try:
  from redis import Redis
except ImportError:  # pragma: no cover - fallback for environments without redis installed
  Redis = None

_CACHE_NAMESPACE = "dtr-cache:"
_DEFAULT_TTL_SECONDS = 30.0
_cache_lock = Lock()
_cache_entries: dict[str, tuple[float, Any]] = {}
_redis_lock = Lock()
_redis_client: Any | None = None


def _storage_key(cache_key: str) -> str:
  return f"{_CACHE_NAMESPACE}{cache_key}"


def _get_redis_client() -> Any | None:
  if not settings.redis_url.strip() or Redis is None:
    return None

  global _redis_client
  if _redis_client is None:
    with _redis_lock:
      if _redis_client is None:
        try:
          _redis_client = Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=1,
            socket_timeout=1
          )
        except Exception:
          _redis_client = None

  return _redis_client


def _serialize_value(value: Any) -> str:
  return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def _deserialize_value(payload: str) -> Any:
  return json.loads(payload)


def _read_local_value(cache_key: str) -> Any | None:
  now = monotonic()
  storage_key = _storage_key(cache_key)

  with _cache_lock:
    entry = _cache_entries.get(storage_key)
    if not entry:
      return None

    expires_at, value = entry
    if now >= expires_at:
      _cache_entries.pop(storage_key, None)
      return None

    return deepcopy(value)


def _write_local_value(cache_key: str, value: Any, ttl_seconds: float) -> None:
  storage_key = _storage_key(cache_key)
  expires_at = monotonic() + max(ttl_seconds, 0.0)
  with _cache_lock:
    if ttl_seconds <= 0:
      _cache_entries.pop(storage_key, None)
      return

    _cache_entries[storage_key] = (expires_at, deepcopy(value))


def _invalidate_local_values(prefix: str | None = None) -> None:
  with _cache_lock:
    if prefix is None:
      _cache_entries.clear()
      return

    storage_prefix = _storage_key(prefix)
    for cache_key in list(_cache_entries.keys()):
      if cache_key.startswith(storage_prefix):
        _cache_entries.pop(cache_key, None)


def _read_redis_value(cache_key: str) -> tuple[bool, Any | None]:
  client = _get_redis_client()
  if client is None:
    return False, None

  try:
    payload = client.get(_storage_key(cache_key))
  except Exception:
    return False, None

  if payload is None:
    return True, None

  try:
    return True, _deserialize_value(payload)
  except Exception:
    return True, None


def _write_redis_value(cache_key: str, value: Any, ttl_seconds: float) -> None:
  client = _get_redis_client()
  if client is None:
    return

  storage_key = _storage_key(cache_key)
  if ttl_seconds <= 0:
    try:
      client.delete(storage_key)
    except Exception:
      pass
    return

  try:
    client.set(storage_key, _serialize_value(value), ex=max(int(ttl_seconds), 1))
  except Exception:
    pass


def _invalidate_redis_values(prefix: str | None = None) -> None:
  client = _get_redis_client()
  if client is None:
    return

  match_prefix = _storage_key(prefix or "")
  try:
    keys = list(client.scan_iter(match=f"{match_prefix}*"))
    if keys:
      client.delete(*keys)
  except Exception:
    pass


def get_cached_value(cache_key: str) -> Any | None:
  has_redis_result, redis_value = _read_redis_value(cache_key)
  if has_redis_result:
    return redis_value

  return _read_local_value(cache_key)


def set_cached_value(cache_key: str, value: Any, ttl_seconds: float = _DEFAULT_TTL_SECONDS) -> None:
  _write_redis_value(cache_key, value, ttl_seconds)
  _write_local_value(cache_key, value, ttl_seconds)


def invalidate_cached_values(prefix: str | None = None) -> None:
  _invalidate_redis_values(prefix)
  _invalidate_local_values(prefix)
