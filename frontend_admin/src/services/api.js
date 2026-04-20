import { supabase } from "./supabase";
import { getPortalSession } from "./session";

const FALLBACK_PRODUCTION_API_URL = "https://tesda-dtr-system-backend.onrender.com";

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

const CACHE_REVISION_TTL_MS = 5 * 1000;
let cachedRevision = "";
let cachedRevisionAt = 0;
let cachedRevisionPromise = null;
const SERVER_ERROR_STATUSES = new Set([500, 502, 503, 504]);

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

function buildSearchParams(params = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && `${value}`.trim() !== "") {
      searchParams.set(key, value);
    }
  });

  return searchParams.toString();
}

const MASTER_SHEET_CACHE_PREFIX = "admin-master-sheet-cache:";
const MASTER_SHEET_CACHE_TTL_MS = 15 * 60 * 1000;
const inMemoryMasterSheetCache = new Map();

function getMasterSheetCacheKey(params = {}) {
  const category = String(params.category || "all").trim().toLowerCase();
  const dateFrom = String(params.date_from || "").trim();
  const dateTo = String(params.date_to || "").trim();

  return `${MASTER_SHEET_CACHE_PREFIX}${category}:${dateFrom}:${dateTo}`;
}

function readMasterSheetCache(params = {}, revision = "") {
  const cacheKey = getMasterSheetCacheKey(params);
  const memoryEntry = inMemoryMasterSheetCache.get(cacheKey);
  if (memoryEntry && memoryEntry.revision === revision && Date.now() - memoryEntry.savedAt < MASTER_SHEET_CACHE_TTL_MS) {
    return memoryEntry.data;
  }

  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      window.localStorage.removeItem(cacheKey);
      return null;
    }

    if ((parsed.revision || "") !== revision) {
      window.localStorage.removeItem(cacheKey);
      inMemoryMasterSheetCache.delete(cacheKey);
      return null;
    }

    const savedAt = Number(parsed.savedAt || 0);
    if (!savedAt || Date.now() - savedAt >= MASTER_SHEET_CACHE_TTL_MS) {
      window.localStorage.removeItem(cacheKey);
      return null;
    }

    const data = parsed.data && typeof parsed.data === "object" ? parsed.data : null;
    if (!data) {
      window.localStorage.removeItem(cacheKey);
      return null;
    }

    inMemoryMasterSheetCache.set(cacheKey, { data, savedAt, revision: parsed.revision || revision });
    return data;
  } catch {
    window.localStorage.removeItem(cacheKey);
    inMemoryMasterSheetCache.delete(cacheKey);
    return null;
  }
}

function writeMasterSheetCache(params = {}, data, revision = "") {
  const cacheKey = getMasterSheetCacheKey(params);
  const payload = { savedAt: Date.now(), revision, data };
  inMemoryMasterSheetCache.set(cacheKey, { ...payload, data });

  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch {
    // Ignore cache write failures.
  }
}

function clearMasterSheetCache(params = null) {
  if (params) {
    const cacheKey = getMasterSheetCacheKey(params);
    inMemoryMasterSheetCache.delete(cacheKey);

    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
      return;
    }

    window.localStorage.removeItem(cacheKey);
    return;
  }

  inMemoryMasterSheetCache.clear();

  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }

  const keysToRemove = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key && key.startsWith(MASTER_SHEET_CACHE_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => window.localStorage.removeItem(key));

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("master-sheet:invalidate"));
  }
}

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

function notifyServerIssue(message) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }

  window.dispatchEvent(new CustomEvent("server:error", {
    detail: {
      message
    }
  }));
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
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
      }
    });
  } catch {
    const message = "Server disconnected. Please refresh the page.";
    notifyServerIssue(message);
    throw new Error(message);
  }

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

    if (SERVER_ERROR_STATUSES.has(response.status)) {
      notifyServerIssue("Server error. Please refresh the page.");
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
  getEmployees(category) {
    return request(`/employees?category=${category}`);
  },
  updateAttendance(attendanceId, payload) {
    return request(`/attendance/${attendanceId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }).then((data) => {
      invalidateCacheRevision();
      clearMasterSheetCache();
      return data;
    });
  },
  listAuthorizedEmails() {
    return request("/settings/auth-emails");
  },
  addAuthorizedEmail(payload) {
    return request("/settings/auth-emails", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateAuthorizedEmail(emailId, payload) {
    return request(`/settings/auth-emails/${emailId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  },
  createEmployee(payload) {
    return request("/employees", {
      method: "POST",
      body: JSON.stringify(payload)
    }).then((data) => {
      invalidateCacheRevision();
      clearMasterSheetCache();
      return data;
    });
  },
  updateEmployee(employeeId, payload) {
    return request(`/employees/${employeeId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }).then((data) => {
      invalidateCacheRevision();
      clearMasterSheetCache();
      return data;
    });
  },
  deleteEmployee(employeeId) {
    return request(`/employees/${employeeId}`, { method: "DELETE" }).then((data) => {
      invalidateCacheRevision();
      clearMasterSheetCache();
      return data;
    });
  },
  getMasterAttendance(params) {
    const searchParams = buildSearchParams(params);
    return request(`/attendance/master?${searchParams}`);
  },
  getMasterSheet(params, options = {}) {
    return getCacheRevision().then((revision) => {
      if (!options.forceRefresh) {
        const cachedSheet = readMasterSheetCache(params, revision);
        if (cachedSheet) {
          return Promise.resolve(cachedSheet);
        }
      }

      const searchParams = buildSearchParams(params);
      return request(`/attendance/master-sheet?${searchParams}`).then((data) => {
        writeMasterSheetCache(params, data, revision);
        return data;
      });
    });
  },
  clearMasterSheetCache(params) {
    clearMasterSheetCache(params);
  },
  getScheduleSettings(date) {
    return request(`/settings/schedule-threshold?date=${date}`);
  },
  setScheduleSettings(payload) {
    return request("/settings/schedule-threshold", {
      method: "PUT",
      body: JSON.stringify(payload)
    }).then((data) => {
      invalidateCacheRevision();
      clearMasterSheetCache();
      return data;
    });
  },
  saveMasterSheetRecord(payload) {
    return request("/attendance/master-sheet", {
      method: "PUT",
      body: JSON.stringify(payload)
    }).then((data) => {
      invalidateCacheRevision();
      clearMasterSheetCache();
      return data;
    });
  },
  exportMasterSheet(params) {
    const searchParams = buildSearchParams(params);
    return request(`/attendance/master-sheet/export?${searchParams}`);
  },
  getMonthlySummary(month) {
    return request(`/reports/monthly-summary?month=${month}`);
  },
  getLateReport(month) {
    return request(`/reports/late-report?month=${month}`);
  },
  exportReport(format, month) {
    return request(`/reports/export?format=${format}&month=${month}`);
  },
  triggerManualBackup() {
    return request("/backups/manual", { method: "POST" });
  },
  listBackups() {
    return request("/backups");
  },
  restoreBackup(filename) {
    return request("/backups/restore", {
      method: "POST",
      body: JSON.stringify({ filename })
    }).then((data) => {
      invalidateCacheRevision();
      clearMasterSheetCache();
      return data;
    });
  }
};

export { API_BASE_URL };
