import { useEffect, useState } from "react";
import { api } from "../services/api";

export default function BackupPage() {
  const [backups, setBackups] = useState([]);
  const [status, setStatus] = useState("Ready");

  async function loadBackups() {
    setStatus("Loading backups...");
    try {
      const items = await api.listBackups();
      setBackups(items);
      setStatus("Ready");
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => {
    loadBackups();
  }, []);

  async function createBackup() {
    setStatus("Creating manual backup...");
    try {
      await api.triggerManualBackup();
      await loadBackups();
      setStatus("Manual backup completed");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function restoreBackup(filename) {
    setStatus(`Restoring ${filename}...`);
    try {
      await api.restoreBackup(filename);
      setStatus("Backup restored");
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <section className="card">
      <h2>Backup and Restore</h2>
      <p className="subtle">Automatic backup runs daily on the backend scheduler.</p>
      <p className="subtle">Status: {status}</p>

      <div className="toolbar">
        <button type="button" onClick={createBackup}>Run Manual Backup</button>
      </div>

      <ul className="backup-list">
        {backups.map((backup) => (
          <li key={backup.name}>
            <span>{backup.name}</span>
            <button type="button" onClick={() => restoreBackup(backup.name)}>Restore</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
