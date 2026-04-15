import { useEffect, useMemo, useState } from "react";
import LoginScreen from "./components/LoginScreen";
import NavBar from "./components/NavBar";
import BackupPage from "./pages/BackupPage";
import EmployeesPage from "./pages/EmployeesPage";
import MasterSheetPage from "./pages/MasterSheetPage";
import ReportsPage from "./pages/ReportsPage";
import ScheduleSettingsPage from "./pages/ScheduleSettingsPage";
import { isAllowedAuthEmail } from "./services/auth";
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
