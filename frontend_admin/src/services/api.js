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
  createEmployee(payload) {
    return request("/employees", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  updateEmployee(employeeId, payload) {
    return request(`/employees/${employeeId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },
  deleteEmployee(employeeId) {
    return request(`/employees/${employeeId}`, { method: "DELETE" });
  },
  getMasterAttendance(params) {
    const searchParams = new URLSearchParams(params).toString();
    return request(`/attendance/master?${searchParams}`);
  },
  getDailyThreshold(date) {
    return request(`/settings/schedule-threshold?date=${date}`);
  },
  setDailyThreshold(payload) {
    return request("/settings/schedule-threshold", {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },
  getMonthlySummary(month) {
    return request(`/reports/monthly-summary?month=${month}`);
  },
  getLateReport(month) {
    return request(`/reports/late-report?month=${month}`);
  },
  getOvertimeReport(month) {
    return request(`/reports/overtime-report?month=${month}`);
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
    });
  }
};

export { API_BASE_URL };
