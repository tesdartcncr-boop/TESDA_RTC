const PORTAL_SESSION_KEY = "dtr_portal_session";

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeSession(session) {
  if (!session) {
    return null;
  }

  const email = (session.user?.email || session.email || "").trim().toLowerCase();
  const accessToken = session.access_token || session.portal_token || "";
  const expiresAt = Number(session.expires_at || session.exp || 0) || null;

  if (!email || !accessToken) {
    return null;
  }

  return {
    access_token: accessToken,
    expires_at: expiresAt,
    token_type: session.token_type || "bearer",
    user: { email }
  };
}

export function getPortalSession() {
  if (!isBrowser()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(PORTAL_SESSION_KEY);
    if (!raw) {
      return null;
    }

    const session = normalizeSession(JSON.parse(raw));
    if (!session) {
      window.localStorage.removeItem(PORTAL_SESSION_KEY);
      return null;
    }

    if (session.expires_at && Date.now() / 1000 >= session.expires_at) {
      window.localStorage.removeItem(PORTAL_SESSION_KEY);
      return null;
    }

    return session;
  } catch {
    window.localStorage.removeItem(PORTAL_SESSION_KEY);
    return null;
  }
}

export function setPortalSession(session) {
  if (!isBrowser()) {
    return;
  }

  const normalized = normalizeSession(session);
  if (!normalized) {
    window.localStorage.removeItem(PORTAL_SESSION_KEY);
    return;
  }

  window.localStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(normalized));
}

export function clearPortalSession() {
  if (!isBrowser()) {
    return;
  }

  window.localStorage.removeItem(PORTAL_SESSION_KEY);
}