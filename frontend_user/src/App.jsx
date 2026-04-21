import { useEffect, useMemo, useRef, useState } from "react";
import EmployeeGrid from "./components/EmployeeGrid";
import LoginScreen from "./components/LoginScreen";
import EmployeeTabs from "./components/EmployeeTabs";
import { api } from "./services/api";
import { clearPortalSession, getPortalSession } from "./services/session";
import { supabase } from "./services/supabase";
import { connectRealtime } from "./services/socket";

const MANILA_TIME_ZONE = "Asia/Manila";
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

function getManilaDateParts(referenceDate = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(referenceDate);

  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function getManilaDate(referenceDate = new Date()) {
  const values = getManilaDateParts(referenceDate);

  return `${values.year}-${values.month}-${values.day}`;
}

function getMillisecondsUntilNextManilaMidnight(referenceDate = new Date()) {
  const values = getManilaDateParts(referenceDate);
  const nextMidnightUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + 1, 0, 0, 0) - MANILA_OFFSET_MS;

  return Math.max(nextMidnightUtc - referenceDate.getTime(), 1_000);
}

function getCategoryTitle(category) {
  return category === "regular" ? "Regular Employees" : "Job Order Employees";
}

function getCategorySummary(category) {
  return category === "regular" ? "Permanent staff roster" : "Job Order roster";
}

const USER_UI_STATE_KEY = "dtr_user_ui_state:v1";

function getDefaultUserUiState() {
  return {
    activeCategory: "regular",
    employeeSearch: "",
    employeeSearchDraft: ""
  };
}

function normalizeActiveCategory(value) {
  return value === "jo" ? "jo" : "regular";
}

function readUserUiState() {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return getDefaultUserUiState();
  }

  try {
    const raw = window.localStorage.getItem(USER_UI_STATE_KEY);
    if (!raw) {
      return getDefaultUserUiState();
    }

    const parsed = JSON.parse(raw);
    return {
      activeCategory: normalizeActiveCategory(parsed?.activeCategory),
      employeeSearch: typeof parsed?.employeeSearch === "string" ? parsed.employeeSearch : "",
      employeeSearchDraft: typeof parsed?.employeeSearchDraft === "string" ? parsed.employeeSearchDraft : ""
    };
  } catch {
    return getDefaultUserUiState();
  }
}

function writeUserUiState(nextState) {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(USER_UI_STATE_KEY, JSON.stringify(nextState));
  } catch {
    // Ignore storage write failures.
  }
}

function clearUserUiState() {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }

  window.localStorage.removeItem(USER_UI_STATE_KEY);
}

function formatDisplayDate(dateIso) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  return new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const initialUserUiState = readUserUiState();
  const [activeCategory, setActiveCategory] = useState(initialUserUiState.activeCategory);
  const [selectedDate, setSelectedDate] = useState(() => getManilaDate());
  const [selectedSchedule, setSelectedSchedule] = useState("A");
  const [scheduleSetting, setScheduleSetting] = useState(null);
  const [employeeSearch, setEmployeeSearch] = useState(initialUserUiState.employeeSearch);
  const [employeeSearchDraft, setEmployeeSearchDraft] = useState(initialUserUiState.employeeSearchDraft || initialUserUiState.employeeSearch);
  const [employees, setEmployees] = useState([]);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("Ready");
  const [isDashboardLoading, setIsDashboardLoading] = useState(true);
  const [isLoadingPopupVisible, setIsLoadingPopupVisible] = useState(false);
  const [serverIssue, setServerIssue] = useState("");
  const manilaDateRef = useRef(getManilaDate());
  const activeCategoryRef = useRef(activeCategory);
  const selectedDateRef = useRef(selectedDate);
  const loadRequestRef = useRef(0);
  const serverRefreshTimerRef = useRef(null);

  useEffect(() => {
    const syncManilaDate = () => {
      const nextManilaDate = getManilaDate();

      if (nextManilaDate === manilaDateRef.current) {
        return;
      }

      const previousManilaDate = manilaDateRef.current;
      manilaDateRef.current = nextManilaDate;

      setSelectedDate((currentDate) => (currentDate === previousManilaDate ? nextManilaDate : currentDate));
    };

    let timeoutId;

    const scheduleNextSync = () => {
      syncManilaDate();
      timeoutId = window.setTimeout(scheduleNextSync, getMillisecondsUntilNextManilaMidnight());
    };

    timeoutId = window.setTimeout(scheduleNextSync, getMillisecondsUntilNextManilaMidnight());
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    activeCategoryRef.current = activeCategory;
  }, [activeCategory]);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    writeUserUiState({
      activeCategory,
      employeeSearch,
      employeeSearchDraft
    });
  }, [activeCategory, employeeSearch, employeeSearchDraft]);

  useEffect(() => {
    if (!session || !isDashboardLoading) {
      setIsLoadingPopupVisible(false);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setIsLoadingPopupVisible(true);
    }, 120);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isDashboardLoading, session]);

  useEffect(() => {
    function handleServerIssue(event) {
      const message = event.detail?.message || "Server disconnected. Please refresh the page.";
      setServerIssue(message);
      setStatus(message);
    }

    window.addEventListener("server:error", handleServerIssue);
    return () => window.removeEventListener("server:error", handleServerIssue);
  }, []);

  useEffect(() => {
    if (!serverIssue) {
      return undefined;
    }

    if (serverRefreshTimerRef.current) {
      window.clearTimeout(serverRefreshTimerRef.current);
    }

    serverRefreshTimerRef.current = window.setTimeout(() => {
      window.location.reload();
    }, 5000);

    return () => {
      if (serverRefreshTimerRef.current) {
        window.clearTimeout(serverRefreshTimerRef.current);
        serverRefreshTimerRef.current = null;
      }
    };
  }, [serverIssue]);

  useEffect(() => {
    let mounted = true;

    async function initializeSession() {
      try {
        const portalSession = getPortalSession();
        if (portalSession) {
          setSession(portalSession);
          setAuthMessage("");
          setAuthReady(true);
          return;
        }
      } catch {
        clearPortalSession();
      }

      const { data } = await supabase.auth.getSession();

      if (!mounted) {
        return;
      }

      const currentSession = data.session;
      setSession(currentSession);
      setAuthMessage("");

      setAuthReady(true);
    }

    initializeSession().catch((error) => {
      setAuthMessage(error.message);
      setAuthReady(true);
    });

    return () => {
      mounted = false;
    };
  }, []);

  async function loadEmployees(category, options = {}) {
    const data = await api.getEmployees(category, options);
    setEmployees(data);
  }

  async function loadAttendance(date, category) {
    const data = await api.getDailyAttendance(date, category);
    setRows(data);
  }

  async function loadSchedule(date) {
    const data = await api.getScheduleSettings(date);
    setScheduleSetting(data);
    setSelectedSchedule(data.schedule_type || "A");
  }

  function handleSearchSubmit(event) {
    event.preventDefault();
    setEmployeeSearch(employeeSearchDraft.trim());
  }

  function handleClearSearch() {
    setEmployeeSearchDraft("");
    setEmployeeSearch("");
  }

  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;
    const requestId = ++loadRequestRef.current;

    async function refreshDashboardData() {
      setIsDashboardLoading(true);
      setStatus("Loading data...");
      try {
        const [employeeData, attendanceData, scheduleData] = await Promise.all([
          api.getEmployees(activeCategory),
          api.getDailyAttendance(selectedDate, activeCategory),
          api.getScheduleSettings(selectedDate)
        ]);

        if (cancelled || loadRequestRef.current !== requestId) {
          return;
        }

        setEmployees(employeeData);
        setRows(attendanceData);
        setScheduleSetting(scheduleData);
        setSelectedSchedule(scheduleData.schedule_type || "A");
        setStatus("Live");
      } catch (error) {
        if (!cancelled && loadRequestRef.current === requestId) {
          setStatus(error.message);
        }
      } finally {
        if (!cancelled && loadRequestRef.current === requestId) {
          setIsDashboardLoading(false);
        }
      }
    }

    refreshDashboardData();

    return () => {
      cancelled = true;
    };
  }, [activeCategory, selectedDate, session]);

  useEffect(() => {
    if (!session?.access_token) {
      return undefined;
    }

    let isCleaningUp = false;
    let hasReportedDisconnect = false;
    const socket = connectRealtime((payload) => {
      const currentCategory = activeCategoryRef.current;
      const currentDate = selectedDateRef.current;

      if (payload.type === "attendance.updated") {
        loadAttendance(currentDate, currentCategory).catch(() => {});
        loadSchedule(currentDate).catch(() => {});
      } else if (payload.type === "employee.created" || payload.type === "employee.updated" || payload.type === "employee.deleted") {
        api.clearEmployeeCache();
        loadEmployees(currentCategory, { forceRefresh: true }).catch(() => {});
      } else if (payload.type === "backup.restored") {
        api.clearEmployeeCache();
        loadEmployees(currentCategory, { forceRefresh: true }).catch(() => {});
        loadAttendance(currentDate, currentCategory).catch(() => {});
        loadSchedule(currentDate).catch(() => {});
      }
    }, session.access_token);

    const reportDisconnect = (message) => {
      if (isCleaningUp || hasReportedDisconnect) {
        return;
      }

      hasReportedDisconnect = true;
      window.dispatchEvent(new CustomEvent("server:error", {
        detail: { message }
      }));
    };

    socket.onclose = () => {
      reportDisconnect("Realtime connection lost. Please refresh the page.");
    };

    socket.onerror = () => {
      reportDisconnect("Realtime connection lost. Please refresh the page.");
    };

    return () => {
      isCleaningUp = true;
      socket.close();
    };
  }, [session?.access_token]);

  async function handleClock(employeeId, employeePassword, leaveType) {
    setStatus("Saving time record...");
    try {
      await api.clockAttendance({
        employee_id: employeeId,
        date: selectedDate,
        schedule_type: scheduleSetting?.schedule_type || selectedSchedule,
        leave_type: leaveType,
        employee_password: employeePassword
      });
      await loadAttendance(selectedDate, activeCategory);
      setStatus("Time record saved");
    } catch (error) {
      setStatus(error.message);
      throw error;
    }
  }

  async function handleCellUpdate(attendanceId, field, value) {
    const nextRows = rows.map((row) => (row.id === attendanceId ? { ...row, [field]: value } : row));
    setRows(nextRows);

    try {
      const updated = await api.updateAttendance(attendanceId, { [field]: value, date: selectedDate });
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    } catch (error) {
      setStatus(error.message);
    }
  }

  const attendanceByEmployeeId = useMemo(() => new Map(rows.map((row) => [row.employee_id, row])), [rows]);
  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();

    if (!query) {
      return employees;
    }

    return employees.filter((employee) => (employee.name || "").toLowerCase().includes(query));
  }, [employeeSearch, employees]);

  const activeCategoryTitle = getCategoryTitle(activeCategory);
  const activeCategorySummary = getCategorySummary(activeCategory);
  const activeScheduleType = scheduleSetting?.schedule_type || selectedSchedule;
  const scheduleLocked = Boolean(scheduleSetting?.has_override);
  const selectedScheduleLabel = activeScheduleType === "A" ? "A (08:00-17:00)" : "B (08:00-19:00)";
  const showLoadingPopup = Boolean(session) && isDashboardLoading && isLoadingPopupVisible;
  const serverIssuePopup = serverIssue ? (
    <div className="server-error-backdrop" role="presentation">
      <section className="server-error-card" role="alertdialog" aria-modal="true" aria-labelledby="server-error-title">
        <p className="section-kicker">Connection lost</p>
        <h2 id="server-error-title">Server disconnected</h2>
        <p>{serverIssue}</p>
        <p className="subtle">This page will refresh automatically in a few seconds.</p>
        <button type="button" className="primary-btn" onClick={() => window.location.reload()}>
          Refresh now
        </button>
      </section>
    </div>
  ) : null;

  async function handleSignOut() {
    clearUserUiState();
    clearPortalSession();
    setSession(null);
    setAuthMessage("");
    setActiveCategory("regular");
    setEmployeeSearch("");
    setEmployeeSearchDraft("");
    await supabase.auth.signOut();
  }

  if (!authReady) {
    return (
      <>
        <LoginScreen
          portalName="DTR Automation User Portal"
          description="Checking your session before opening the attendance dashboard."
          errorMessage="Checking your session..."
        />
        {serverIssuePopup}
      </>
    );
  }

  if (!session) {
    return (
      <>
        <LoginScreen
          portalName="DTR Automation User Portal"
          description="Use an approved TESDA email to request an OTP and open the user portal."
          errorMessage={authMessage}
          onAuthenticated={(nextSession) => {
            setSession(nextSession);
            setAuthMessage("");
            setAuthReady(true);
          }}
        />
        {serverIssuePopup}
      </>
    );
  }

  return (
    <main className="page user-page">
      <section className="surface user-header-card">
        <header className="user-topbar">
          <div className="user-topbar__copy">
            <p className="section-kicker">Attendance dashboard</p>
            <h1>DTR Automation User Portal</h1>
          </div>
          <button type="button" className="secondary-btn" onClick={handleSignOut}>
            Sign out
          </button>
        </header>

        <div className="roster-toolbar">
          <EmployeeTabs activeCategory={activeCategory} onChange={setActiveCategory} />

          <form className="roster-search-form" onSubmit={handleSearchSubmit}>
            <label className="roster-search">
              <span>Find employee</span>
              <input
                type="search"
                placeholder="Type a name to filter the roster"
                value={employeeSearchDraft}
                onChange={(event) => setEmployeeSearchDraft(event.target.value)}
              />
            </label>

            <button type="submit" className="secondary-btn roster-search-submit">
              Search
            </button>

            <button
              type="button"
              className="secondary-btn roster-clear"
              onClick={handleClearSearch}
              disabled={!employeeSearchDraft.trim() && !employeeSearch.trim()}
            >
              Clear
            </button>
          </form>
        </div>
      </section>

      <section className="surface user-workspace">
        <EmployeeGrid
          employees={filteredEmployees}
          attendanceByEmployeeId={attendanceByEmployeeId}
          onClock={handleClock}
          isLoading={isDashboardLoading}
          emptyMessage={employeeSearch.trim() ? "No employees match your search." : "No employees found for this category."}
        />

        <div className="filters user-clock-controls">
          <label>
            Date
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
          <label>
            Schedule Type
            <select value={selectedSchedule} onChange={(event) => setSelectedSchedule(event.target.value)} disabled={scheduleLocked}>
              <option value="A">A (08:00-17:00)</option>
              <option value="B">B (08:00-19:00)</option>
            </select>
          </label>
          {scheduleLocked ? <p className="hint">This date is locked to the admin schedule override.</p> : <p className="hint">Choose the schedule used for this clock action.</p>}
        </div>

        <div className="user-summary-footer">
          <div className="status-strip user-status-strip">
            <div className="status-card">
              <span>Category</span>
              <strong>{activeCategoryTitle}</strong>
              <p>{activeCategorySummary}</p>
            </div>
            <div className="status-card">
              <span>Employees</span>
              <strong>{filteredEmployees.length}</strong>
              <p>{employees.length} loaded</p>
            </div>
            <div className="status-card">
              <span>Status</span>
              <strong>{status}</strong>
              <p>{selectedScheduleLabel}</p>
            </div>
          </div>
        </div>
      </section>

      {showLoadingPopup ? (
        <div className="roster-loading-backdrop" role="status" aria-live="polite" aria-atomic="true">
          <div className="roster-loading-card">
            <span className="roster-loading-spinner" aria-hidden="true" />
            <p className="section-kicker">Switching roster</p>
            <h2>Loading {activeCategoryTitle}</h2>
            <p>Refreshing employee names and attendance data.</p>
          </div>
        </div>
      ) : null}
    </main>
  );
}