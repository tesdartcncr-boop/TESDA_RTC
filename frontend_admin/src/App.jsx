import { useEffect, useMemo, useState } from "react";
import NavBar from "./components/NavBar";
import BackupPage from "./pages/BackupPage";
import EmployeesPage from "./pages/EmployeesPage";
import MasterSheetPage from "./pages/MasterSheetPage";
import ReportsPage from "./pages/ReportsPage";
import ScheduleSettingsPage from "./pages/ScheduleSettingsPage";
import { connectRealtime } from "./services/socket";

const PAGE_COMPONENTS = {
  employees: <EmployeesPage />,
  master: <MasterSheetPage />,
  schedule: <ScheduleSettingsPage />,
  reports: <ReportsPage />,
  backups: <BackupPage />
};

export default function App() {
  const [activePage, setActivePage] = useState("employees");
  const [updates, setUpdates] = useState([]);

  useEffect(() => {
    const socket = connectRealtime((payload) => {
      setUpdates((prev) => [payload.message || "Live update received", ...prev].slice(0, 8));
    });

    return () => socket.close();
  }, []);

  const latestEvent = useMemo(() => updates[0] || "No updates yet", [updates]);

  return (
    <main className="admin-page">
      <header className="admin-hero">
        <h1>DTR Automation Admin Portal</h1>
        <p>Manage employees, attendance history, reports, and backup lifecycle.</p>
        <p className="event-pill">Realtime: {latestEvent}</p>
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
