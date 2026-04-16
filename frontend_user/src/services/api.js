import { supabase } from "./supabase";
import { clearPortalSession, getPortalSession } from "./session";

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
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {})
    },
    ...options
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
  getEmployees(category) {
    return request(`/employees?category=${category}`);
  },
  getDailyAttendance(date, category) {
    return request(`/attendance/daily?date=${date}&category=${category}`);
  },
  clockAttendance(payload) {
    return request("/attendance/clock", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateAttendance(id, payload) {
    return request(`/attendance/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },
  getLateThreshold(date) {
    return request(`/settings/schedule-threshold?date=${date}`);
  }
};

export { API_BASE_URL };
