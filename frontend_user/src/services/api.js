import { supabase } from "./supabase";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function getAccessToken() {
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
    const errorBody = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      await supabase.auth.signOut().catch(() => {});
    }
    throw new Error(errorBody.detail || "Request failed.");
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
