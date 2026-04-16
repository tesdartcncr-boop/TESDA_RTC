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
  return category === "regular" ? "Regular Employees" : "JO Employees";
}

function getCategorySummary(category) {
  return category === "regular" ? "Permanent staff roster" : "Job order roster";
}

function getStatusTone(status) {
  const normalized = status.toLowerCase();

  if (normalized.includes("error") || normalized.includes("failed")) {
    return "danger";
  }

  if (normalized.includes("loading") || normalized.includes("saving")) {
    return "busy";
  }

  return "live";
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [activeCategory, setActiveCategory] = useState("regular");
  const [selectedDate, setSelectedDate] = useState(() => getManilaDate());
  const [selectedSchedule, setSelectedSchedule] = useState("A");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employees, setEmployees] = useState([]);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("Ready");
  const manilaDateRef = useRef(getManilaDate());

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

  async function refreshPageData() {
    setStatus("Loading data...");
    try {
      await Promise.all([
        loadEmployees(activeCategory),
        loadAttendance(selectedDate, activeCategory)
      ]);
      setStatus("Live");
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => {
    if (!session) {
      return;
    }

    refreshPageData();
  }, [activeCategory, selectedDate, session]);

  useEffect(() => {
    if (!session?.access_token) {
      return undefined;
    }

    const socket = connectRealtime((payload) => {
      if (payload.type === "attendance.updated") {
        loadAttendance(selectedDate, activeCategory).catch(() => {});
      } else if (payload.type === "employee.created" || payload.type === "employee.updated" || payload.type === "employee.deleted") {
        api.clearEmployeeCache();
        loadEmployees(activeCategory, { forceRefresh: true }).catch(() => {});
      }
    }, session.access_token);

    return () => {
      socket.close();
    };
  }, [selectedDate, activeCategory, session?.access_token]);

  async function handleClock(employeeId, employeePassword, leaveType) {
    setStatus("Saving time record...");
    try {
      await api.clockAttendance({
        employee_id: employeeId,
        date: selectedDate,
        schedule_type: selectedSchedule,
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

  async function handleSignOut() {
    clearPortalSession();
    setSession(null);
    setAuthMessage("");
    await supabase.auth.signOut();
  }

  if (!authReady) {
    return (
      <LoginScreen
        portalName="DTR Automation User Portal"
        description="Checking your session before opening the attendance dashboard."
        errorMessage="Checking your session..."
      />
    );
  }

  if (!session) {
    return (
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
    );
  }

  return (
    <main className="page user-page">
      <header className="surface user-header">
        <div className="user-header__copy">
          <p className="section-kicker">Attendance dashboard</p>
          <h1>DTR Automation User Portal</h1>
        </div>

        <div className="session-bar user-session-bar">
          <span>{session.user.email}</span>
          <button type="button" className="secondary-btn" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <section className="surface user-workspace">
        <div className="roster-toolbar">
          <EmployeeTabs activeCategory={activeCategory} onChange={setActiveCategory} />

          <label className="roster-search">
            <span>Find employee</span>
            <input
              type="search"
              placeholder="Type a name to filter the roster"
              value={employeeSearch}
              onChange={(event) => setEmployeeSearch(event.target.value)}
            />
          </label>

          <button
            type="button"
            className="secondary-btn roster-clear"
            onClick={() => setEmployeeSearch("")}
            disabled={!employeeSearch.trim()}
          >
            Clear
          </button>
        </div>

        <EmployeeGrid
          employees={filteredEmployees}
          attendanceByEmployeeId={attendanceByEmployeeId}
          onClock={handleClock}
          emptyMessage={employeeSearch.trim() ? "No employees match your search." : "No employees found for this category."}
        />

        <div className="filters user-clock-controls">
          <label>
            Date
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
          <label>
            Schedule Type
            <select value={selectedSchedule} onChange={(event) => setSelectedSchedule(event.target.value)}>
              <option value="A">A (08:00-17:00)</option>
              <option value="B">B (08:00-19:00)</option>
            </select>
          </label>
        </div>
      </section>
    </main>
  );
}