import { useEffect, useMemo, useState } from "react";
import AttendanceTable from "./components/AttendanceTable";
import EmployeeGrid from "./components/EmployeeGrid";
import LoginScreen from "./components/LoginScreen";
import EmployeeTabs from "./components/EmployeeTabs";
import { api } from "./services/api";
import { isAllowedAuthEmail } from "./services/auth";
import { supabase } from "./services/supabase";
import { connectRealtime } from "./services/socket";

function getTodayDate() {
  const now = new Date();
  return now.toISOString().split("T")[0];
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
  const [selectedDate, setSelectedDate] = useState(getTodayDate());
  const [selectedSchedule, setSelectedSchedule] = useState("A");
  const [selectedLeaveType, setSelectedLeaveType] = useState("");
  const [employees, setEmployees] = useState([]);
  const [rows, setRows] = useState([]);
  const [threshold, setThreshold] = useState("08:01");
  const [status, setStatus] = useState("Ready");
  const [updates, setUpdates] = useState([]);

  useEffect(() => {
    let mounted = true;

    async function initializeSession() {
      const { data } = await supabase.auth.getSession();

      if (!mounted) {
        return;
      }

      const currentSession = data.session;
      const currentEmail = currentSession?.user?.email || "";

      if (currentSession && !isAllowedAuthEmail(currentEmail)) {
        await supabase.auth.signOut();
        setSession(null);
        setAuthMessage("This email is not allowed to access the portal.");
      } else {
        setSession(currentSession);
        setAuthMessage("");
      }

      setAuthReady(true);
    }

    initializeSession().catch((error) => {
      setAuthMessage(error.message);
      setAuthReady(true);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!mounted) {
        return;
      }

      const nextEmail = nextSession?.user?.email || "";
      if (nextSession && !isAllowedAuthEmail(nextEmail)) {
        await supabase.auth.signOut();
        setSession(null);
        setAuthMessage("This email is not allowed to access the portal.");
        return;
      }

      setSession(nextSession);
      setAuthMessage("");
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function loadEmployees(category) {
    const data = await api.getEmployees(category);
    setEmployees(data);
  }

  async function loadAttendance(date, category) {
    const data = await api.getDailyAttendance(date, category);
    setRows(data);
  }

  async function loadThreshold(date) {
    const data = await api.getLateThreshold(date);
    setThreshold(data.late_threshold);
  }

  async function refreshPageData() {
    setStatus("Loading data...");
    try {
      await Promise.all([
        loadEmployees(activeCategory),
        loadAttendance(selectedDate, activeCategory),
        loadThreshold(selectedDate)
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
      setUpdates((prev) => [payload.message || "Attendance updated", ...prev].slice(0, 6));
      if (payload.type === "attendance.updated") {
        loadAttendance(selectedDate, activeCategory).catch(() => {});
      }
    }, session.access_token);

    return () => {
      socket.close();
    };
  }, [selectedDate, activeCategory, session?.access_token]);

  async function handleClock(employeeId, employeePassword) {
    setStatus("Saving time record...");
    try {
      await api.clockAttendance({
        employee_id: employeeId,
        date: selectedDate,
        schedule_type: selectedSchedule,
        leave_type: selectedLeaveType || null,
        employee_password: employeePassword
      });
      await loadAttendance(selectedDate, activeCategory);
      setStatus("Time record saved");
    } catch (error) {
      setStatus(error.message);
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

  const lastUpdate = useMemo(() => updates[0] || "Waiting for realtime updates...", [updates]);
  const activeCategoryTitle = getCategoryTitle(activeCategory);
  const activeCategorySummary = getCategorySummary(activeCategory);
  const statusTone = useMemo(() => getStatusTone(status), [status]);

  async function handleSignOut() {
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
      />
    );
  }

  return (
    <main className="page">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Attendance dashboard</p>
          <h1>DTR Automation User Portal</h1>
          <p>
            Tap once for Time In, then tap again for Time Out. The refreshed layout keeps the roster switch and live
            status easy to scan.
          </p>
        </div>

        <aside className={`hero-spotlight hero-spotlight--${statusTone}`}>
          <span>Active roster</span>
          <strong>{activeCategoryTitle}</strong>
          <p>{activeCategorySummary}</p>
          <div className="hero-metric">
            <span>Employees loaded</span>
            <strong>{employees.length}</strong>
          </div>
        </aside>
      </header>

      <section className="surface controls">
        <div className="controls-head">
          <div>
            <p className="section-kicker">Roster switch</p>
            <h2>Focus on one employee group at a time.</h2>
            <p className="hint">
              The selector below keeps the page centered on Regular or JO employees without resetting the date.
            </p>
          </div>

          <div className="session-bar">
            <span>{session.user.email}</span>
            <button type="button" className="secondary-btn" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>

        <div className={`status-pill status-pill--${statusTone}`}>{status}</div>

        <EmployeeTabs activeCategory={activeCategory} onChange={setActiveCategory} />

        <div className="filters">
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
          <label>
            Leave Type
            <select value={selectedLeaveType} onChange={(event) => setSelectedLeaveType(event.target.value)}>
              <option value="">None</option>
              <option value="SL">SL</option>
              <option value="VL">VL</option>
              <option value="OB">OB</option>
            </select>
          </label>
        </div>

        <div className="status-strip">
          <article className="status-card">
            <span>Late threshold</span>
            <strong>{threshold}</strong>
          </article>
          <article className="status-card">
            <span>Realtime</span>
            <strong>{lastUpdate}</strong>
          </article>
          <article className="status-card">
            <span>Selected view</span>
            <strong>{activeCategoryTitle}</strong>
          </article>
        </div>
      </section>

      <section className="surface">
        <div className="section-head">
          <div>
            <p className="section-kicker">Action cards</p>
            <h2>Employee Cards</h2>
          </div>
          <p className="hint">Tap an employee to write a time entry for the active date and schedule.</p>
        </div>
        <EmployeeGrid employees={employees} onClock={handleClock} />
      </section>

      <section className="surface">
        <div className="section-head">
          <div>
            <p className="section-kicker">Records</p>
            <h2>Daily Attendance</h2>
          </div>
          <p className="hint">Cells are editable. Leave codes can be set to full-day then manually adjusted for partial leave.</p>
        </div>
        <AttendanceTable rows={rows} onCellUpdate={handleCellUpdate} />
      </section>

      <section className="surface updates">
        <div className="section-head">
          <div>
            <p className="section-kicker">Activity</p>
            <h2>Live Updates</h2>
          </div>
          <p className="hint">Realtime events from the socket feed appear here.</p>
        </div>
        <ul>
          {updates.map((message, index) => (
            <li key={`${message}-${index}`}>{message}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
