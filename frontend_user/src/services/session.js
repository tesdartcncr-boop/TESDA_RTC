const PORTAL_SESSION_KEY = "dtr_portal_session";
let activePortalSession = null;

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeSession(session) {
  if (!session) {
    return null;
  }

  const email = (session.user?.email || session.email || "").trim().toLowerCase();
  const accessToken = session.access_token || session.portal_token || "";

  if (!email || !accessToken) {
    return null;
  }

  return {
    access_token: accessToken,
    expires_at: null,
    token_type: session.token_type || "bearer",
    user: { email }
  };
}

export function getPortalSession() {
  if (!isBrowser()) {
    return activePortalSession;
  }

  if (activePortalSession) {
    return activePortalSession;
  }

  try {
    const raw = window.localStorage.getItem(PORTAL_SESSION_KEY);
    if (!raw) {
      return activePortalSession;
    }

    const session = normalizeSession(JSON.parse(raw));
    if (!session) {
      window.localStorage.removeItem(PORTAL_SESSION_KEY);
      return activePortalSession;
    }

    activePortalSession = session;

    return session;
  } catch {
    window.localStorage.removeItem(PORTAL_SESSION_KEY);
    return activePortalSession;
  }
}

export function setPortalSession(session) {
  const normalized = normalizeSession(session);
  if (!normalized) {
    clearPortalSession();
    return;
  }

  activePortalSession = normalized;

  if (!isBrowser()) {
    return;
  }

  window.localStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(normalized));
}

export function clearPortalSession() {
  activePortalSession = null;

  if (!isBrowser()) {
    return;
  }

  window.localStorage.removeItem(PORTAL_SESSION_KEY);
}