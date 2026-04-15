import { useEffect, useMemo, useState } from "react";
import LoginScreen from "./components/LoginScreen";
import NavBar from "./components/NavBar";
import BackupPage from "./pages/BackupPage";
import EmployeesPage from "./pages/EmployeesPage";
import MasterSheetPage from "./pages/MasterSheetPage";
import ReportsPage from "./pages/ReportsPage";
import ScheduleSettingsPage from "./pages/ScheduleSettingsPage";
import { clearPortalSession, getPortalSession } from "./services/session";
import { supabase } from "./services/supabase";
import { connectRealtime } from "./services/socket";

const PAGE_COMPONENTS = {
  employees: <EmployeesPage />,
  master: <MasterSheetPage />,
  schedule: <ScheduleSettingsPage />,
  reports: <ReportsPage />,
  backups: <BackupPage />
};

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [activePage, setActivePage] = useState("employees");
  const [updates, setUpdates] = useState([]);

  useEffect(() => {
    let mounted = true;

    async function initializeSession() {
      try {
        const rawPortalSession = window.localStorage.getItem("dtr_portal_session");
        if (rawPortalSession) {
          const portalSession = JSON.parse(rawPortalSession);
          const expiresAt = Number(portalSession?.expires_at || 0);

          if (expiresAt && Date.now() / 1000 >= expiresAt) {
            window.localStorage.removeItem("dtr_portal_session");
          } else {
            setSession(portalSession);
            setAuthMessage("");
            setAuthReady(true);
            return;
          }
        }
      } catch {
        window.localStorage.removeItem("dtr_portal_session");
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

    const socket = connectRealtime((payload) => {
      setUpdates((prev) => [payload.message || "Live update received", ...prev].slice(0, 8));
    }, session.access_token);

    return () => socket.close();
  }, [session?.access_token]);

  const latestEvent = useMemo(() => updates[0] || "No updates yet", [updates]);

  async function handleSignOut() {
    clearPortalSession();
    setSession(null);
    setAuthMessage("");
    await supabase.auth.signOut();
  }

  if (!authReady) {
    return (
      <LoginScreen
        portalName="DTR Automation Admin Portal"
        description="Checking your session before opening the admin dashboard."
        errorMessage="Checking your session..."
      />
    );
  }

  if (!session) {
    return (
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
    );
  }

  return (
    <main className="admin-page">
      <header className="admin-hero">
        <h1>DTR Automation Admin Portal</h1>
        <p>Manage employees, attendance history, reports, and backup lifecycle.</p>
        <p className="event-pill">Realtime: {latestEvent}</p>
        <div className="session-bar admin-session-bar">
          <span>{session.user.email}</span>
          <button type="button" className="secondary-btn" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <NavBar activePage={activePage} onChange={setActivePage} />
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
  );
}