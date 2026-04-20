import { useEffect, useMemo, useRef, useState } from "react";
import LoginScreen from "./components/LoginScreen";
import NavBar from "./components/NavBar";
import AuthorizedEmailsPage from "./pages/AuthorizedEmailsPage";
import EmployeesPage from "./pages/EmployeesPage";
import MasterSheetPage from "./pages/MasterSheetPage";
import ReportsPage from "./pages/ReportsPage";
import ScheduleSettingsPage from "./pages/ScheduleSettingsPage";
import { api } from "./services/api";
import { clearPortalSession, getPortalSession } from "./services/session";
import { supabase } from "./services/supabase";
import { connectRealtime } from "./services/socket";

const PAGE_DETAILS = {
  employees: {
    label: "Employees",
    summary: "Shape the roster and keep names, passwords, and categories aligned.",
    accent: "Command roster"
  },
  master: {
    label: "Master Sheet",
    summary: "Edit month-based attendance and day-level schedule overrides with cached Regular and Job Order views.",
    accent: "Attendance grid"
  },
  schedule: {
    label: "Schedule Settings",
    summary: "Tune the date-specific schedule format and late threshold used by attendance calculations.",
    accent: "Policy control"
  },
  authEmails: {
    label: "Authorized Emails",
    summary: "Control which inboxes can request OTP access into the portals.",
    accent: "Access control"
  },
  reports: {
    label: "Reports",
    summary: "Export monthly summaries and late reports for review.",
    accent: "Insights"
  }
};

const PAGE_COMPONENTS = {
  employees: <EmployeesPage />,
  master: <MasterSheetPage />,
  schedule: <ScheduleSettingsPage />,
  authEmails: <AuthorizedEmailsPage />,
  reports: <ReportsPage />,
};

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [activePage, setActivePage] = useState("employees");
  const [updates, setUpdates] = useState([]);
  const [serverIssue, setServerIssue] = useState("");
  const serverRefreshTimerRef = useRef(null);

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

  useEffect(() => {
    if (!session?.access_token) {
      return undefined;
    }

    let isCleaningUp = false;
    let hasReportedDisconnect = false;
    const socket = connectRealtime((payload) => {
      setUpdates((prev) => [payload.message || "Live update received", ...prev].slice(0, 8));

      if (typeof window === "undefined") {
        return;
      }

      const dispatchUpdate = (eventName) => {
        window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
      };

      if (payload.type === "employee.created" || payload.type === "employee.updated" || payload.type === "employee.deleted") {
        api.clearMasterSheetCache();
        dispatchUpdate("employees:invalidate");
        dispatchUpdate("reports:invalidate");
      } else if (payload.type === "attendance.updated") {
        api.clearMasterSheetCache();
        dispatchUpdate("reports:invalidate");
        dispatchUpdate("schedule-settings:invalidate");
      } else if (payload.type === "settings.auth_email.added" || payload.type === "settings.auth_email.updated") {
        dispatchUpdate("auth-emails:invalidate");
      } else if (payload.type === "backup.restored") {
        api.clearMasterSheetCache();
        dispatchUpdate("employees:invalidate");
        dispatchUpdate("reports:invalidate");
        dispatchUpdate("schedule-settings:invalidate");
        dispatchUpdate("auth-emails:invalidate");
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

  useEffect(() => {
    function handleServerIssue(event) {
      const message = event.detail?.message || "Server disconnected. Please refresh the page.";
      setServerIssue(message);
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

  const latestEvent = useMemo(() => updates[0] || "No updates yet", [updates]);
  const activePageInfo = PAGE_DETAILS[activePage] || PAGE_DETAILS.employees;
  const isMasterPage = activePage === "master";
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
    clearPortalSession();
    setSession(null);
    setAuthMessage("");
    await supabase.auth.signOut();
  }

  if (!authReady) {
    return (
      <>
        <LoginScreen
          portalName="DTR Automation Admin Portal"
          description="Checking your session before opening the admin dashboard."
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
          portalName="DTR Automation Admin Portal"
          description="Use an approved TESDA email to request an OTP and open the admin portal."
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
    <>
    <main className={isMasterPage ? "admin-page admin-page--master" : "admin-page"}>
      <header className="admin-hero">
        <div className="dashboard-header">
          <div className="dashboard-header__copy">
            <p className="section-kicker">Command center</p>
            <h1>DTR Automation Admin Portal</h1>
            <p>
              Manage employees, attendance history, and reports from one editorial workspace built for speed and
              clarity.
            </p>
          </div>

          <div className="dashboard-header__meta">
            <div className="dashboard-stats">
              <article className="dashboard-stat">
                <span>Active section</span>
                <strong>{activePageInfo.label}</strong>
                <p>{activePageInfo.summary}</p>
              </article>
              <article className="dashboard-stat">
                <span>Realtime feed</span>
                <strong>{updates.length}</strong>
                <p>{latestEvent}</p>
              </article>
            </div>

            <div className="session-bar admin-session-bar">
              <span>{session.user.email}</span>
              <button type="button" className="secondary-btn" onClick={handleSignOut}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      <NavBar activePage={activePage} onChange={setActivePage} />

      <div className="status-strip admin-status-strip">
        <div className="status-card">
          <span>Workspace</span>
          <strong>{activePageInfo.accent}</strong>
          <p>{activePageInfo.summary}</p>
        </div>
        <div className="status-card">
          <span>Live update</span>
          <strong>{latestEvent}</strong>
          <p>{updates.length ? `${updates.length} recent events` : "Waiting for activity"}</p>
        </div>
        <div className="status-card">
          <span>Signed in</span>
          <strong>{session.user.email}</strong>
          <p>OTP-authenticated admin session.</p>
        </div>
      </div>

      {PAGE_COMPONENTS[activePage]}

      <section className="card">
        <h2>Realtime Feed</h2>
        <ul className="report-list">
          {updates.map((update, index) => (
            <li key={`${update}-${index}`}>{update}</li>
          ))}
        </ul>
      </section>
    </main>
    {serverIssuePopup}
    </>
  );
}