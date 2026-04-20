import { supabase } from "./supabase";
import { clearPortalSession, getPortalSession } from "./session";

const FALLBACK_PRODUCTION_API_URL = "https://tesda-dtr-system-backend.onrender.com";
const EMPLOYEE_CACHE_PREFIX = "dtr_employee_cache:v1:";
const EMPLOYEE_CACHE_TTL_MS = 10 * 60 * 1000;
const knownEmployeeCategories = new Set(["regular", "jo"]);
const inMemoryEmployeeCache = new Map();
const CACHE_REVISION_TTL_MS = 5 * 1000;
let cachedRevision = "";
let cachedRevisionAt = 0;
let cachedRevisionPromise = null;

function invalidateCacheRevision() {
  cachedRevision = "";
  cachedRevisionAt = 0;
  cachedRevisionPromise = null;
}

async function getCacheRevision(forceRefresh = false) {
  if (!forceRefresh && cachedRevision && Date.now() - cachedRevisionAt < CACHE_REVISION_TTL_MS) {
    return cachedRevision;
  }

  if (cachedRevisionPromise) {
    return cachedRevisionPromise;
  }

  cachedRevisionPromise = request("/cache-revision")
    .then((data) => {
      cachedRevision = String(data?.revision || "");
      cachedRevisionAt = Date.now();
      return cachedRevision;
    })
    .catch(() => "")
    .finally(() => {
      cachedRevisionPromise = null;
    });

  return cachedRevisionPromise;
}

function resolveApiBaseUrl() {
  const configuredUrl = (
    import.meta.env.VITE_BACKEND_API_URL || import.meta.env.VITE_API_BASE_URL || ""
  )
    .trim()
    .replace(/\/$/, "");

  if (import.meta.env.PROD) {
    if (configuredUrl && !/localhost|127\.0\.0\.1/.test(configuredUrl)) {
      return configuredUrl;
    }

    return FALLBACK_PRODUCTION_API_URL;
  }

  return configuredUrl || "http://localhost:8000";
}

const API_BASE_URL = resolveApiBaseUrl();

function formatErrorDetail(detail) {
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        const location = Array.isArray(item?.loc) ? item.loc.slice(1).join(".") : "";
        const message = item?.msg || item?.message || "Invalid request.";
        return location ? `${location}: ${message}` : message;
      })
      .join("; ");
  }

  if (detail && typeof detail === "object") {
    return detail.detail || detail.message || detail.error || "Request failed.";
  }

  return "";
}

function getEmployeeCacheKey(category) {
  return `${EMPLOYEE_CACHE_PREFIX}${category}`;
}

function readEmployeeCache(category, revision = "") {
  const memoryEntry = inMemoryEmployeeCache.get(category);
  if (memoryEntry && memoryEntry.revision === revision && Date.now() - memoryEntry.savedAt < EMPLOYEE_CACHE_TTL_MS) {
    return memoryEntry.data;
  }

  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getEmployeeCacheKey(category));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      window.localStorage.removeItem(getEmployeeCacheKey(category));
      return null;
    }

    if ((parsed.revision || "") !== revision) {
      window.localStorage.removeItem(getEmployeeCacheKey(category));
      inMemoryEmployeeCache.delete(category);
      return null;
    }

    const savedAt = Number(parsed.savedAt || 0);
    if (!savedAt || Date.now() - savedAt >= EMPLOYEE_CACHE_TTL_MS) {
      window.localStorage.removeItem(getEmployeeCacheKey(category));
      return null;
    }

    const data = Array.isArray(parsed.data) ? parsed.data : [];
    inMemoryEmployeeCache.set(category, { data, savedAt, revision: parsed.revision || revision });
    return data;
  } catch {
    window.localStorage.removeItem(getEmployeeCacheKey(category));
    inMemoryEmployeeCache.delete(category);
    return null;
  }
}

function writeEmployeeCache(category, data, revision = "") {
  const payload = { savedAt: Date.now(), revision, data };
  inMemoryEmployeeCache.set(category, { ...payload, data });

  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(getEmployeeCacheKey(category), JSON.stringify(payload));
  } catch {
    // Ignore cache write failures.
  }
}

function clearEmployeeCache(category) {
  if (category) {
    inMemoryEmployeeCache.delete(category);
  } else {
    inMemoryEmployeeCache.clear();
  }

  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }

  const categories = category ? [category] : Array.from(knownEmployeeCategories);
  for (const entryCategory of categories) {
    window.localStorage.removeItem(getEmployeeCacheKey(entryCategory));
  }
}

async function getAccessToken() {
  const portalSession = getPortalSession();
  if (portalSession?.access_token) {
    return portalSession.access_token;
  }

  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}

async function request(path, options = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    let errorMessage = `Request failed (${response.status}).`;

    if (contentType.includes("application/json")) {
      const errorBody = await response.json().catch(() => ({}));
      errorMessage = formatErrorDetail(errorBody.detail) || formatErrorDetail(errorBody) || errorMessage;
    } else {
      const errorText = await response.text().catch(() => "");
      if (errorText.trim()) {
        errorMessage = errorText.trim();
      }
    }

    if (response.status === 401 || response.status === 403) {
      clearPortalSession();
      await supabase.auth.signOut().catch(() => {});
    }
    throw new Error(errorMessage);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.blob();
}

export const api = {
  getEmployees(category, options = {}) {
    const normalizedCategory = category || "regular";
    const forceRefresh = Boolean(options.forceRefresh);

    return getCacheRevision().then((revision) => {
      if (!forceRefresh) {
        const cachedEmployees = readEmployeeCache(normalizedCategory, revision);
        if (cachedEmployees) {
          return Promise.resolve(cachedEmployees);
        }
      }

      return request(`/employees?category=${normalizedCategory}`).then((data) => {
        writeEmployeeCache(normalizedCategory, data, revision);
        return data;
      });
    });
  },
  clearEmployeeCache(category) {
    clearEmployeeCache(category);
  },
  getDailyAttendance(date, category) {
    return request(`/attendance/daily?date=${date}&category=${category}`);
  },
  getScheduleSettings(date) {
    return request(`/settings/schedule-threshold?date=${date}`);
  },
  clockAttendance(payload) {
    return request("/attendance/clock", {
      method: "POST",
      body: JSON.stringify(payload)
    }).then((data) => {
      invalidateCacheRevision();
      return data;
    });
  },
  updateAttendance(id, payload) {
    return request(`/attendance/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }).then((data) => {
      invalidateCacheRevision();
      return data;
    });
  },
  getLateThreshold(date) {
    return request(`/settings/schedule-threshold?date=${date}`);
  }
};

export { API_BASE_URL };
