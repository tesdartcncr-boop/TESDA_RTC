import base64
import hashlib
import hmac
import secrets


PASSWORD_HASH_PREFIX = "pbkdf2_sha256"
PASSWORD_HASH_ITERATIONS = 120_000
PASSWORD_SALT_BYTES = 16


def hash_employee_password(password: str) -> str:
  salt = secrets.token_bytes(PASSWORD_SALT_BYTES)
  digest = hashlib.pbkdf2_hmac(
    "sha256",
    password.encode("utf-8"),
    salt,
    PASSWORD_HASH_ITERATIONS
  )
  salt_token = base64.b64encode(salt).decode("ascii")
  digest_token = base64.b64encode(digest).decode("ascii")
  return f"{PASSWORD_HASH_PREFIX}${PASSWORD_HASH_ITERATIONS}${salt_token}${digest_token}"


def verify_employee_password(password: str, stored_hash: str | None) -> bool:
  if not stored_hash:
    return False

  try:
    prefix, iterations_token, salt_token, digest_token = stored_hash.split("$", 3)
    if prefix != PASSWORD_HASH_PREFIX:
      return False

    iterations = int(iterations_token)
    salt = base64.b64decode(salt_token.encode("ascii"))
    expected_digest = base64.b64decode(digest_token.encode("ascii"))
    actual_digest = hashlib.pbkdf2_hmac(
      "sha256",
      password.encode("utf-8"),
      salt,
      iterations
    )
    return hmac.compare_digest(actual_digest, expected_digest)
  except Exception:
    return False