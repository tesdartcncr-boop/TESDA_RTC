import { useEffect, useState } from "react";
import { api } from "../services/api";

function getTodayDate() {
  return new Date().toISOString().split("T")[0];
}

export default function ScheduleSettingsPage() {
  const [date, setDate] = useState(getTodayDate());
  const [threshold, setThreshold] = useState("08:00");
  const [status, setStatus] = useState("Ready");

  async function loadThreshold(activeDate) {
    try {
      const data = await api.getDailyThreshold(activeDate);
      setThreshold(data.late_threshold);
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => {
    loadThreshold(date);
  }, [date]);

  async function saveThreshold() {
    setStatus("Saving...");
    try {
      await api.setDailyThreshold({ date, late_threshold: threshold });
      setStatus("Late threshold updated");
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <section className="card">
      <h2>Schedule and Late Threshold Override</h2>
      <p className="subtle">Schedule A: 08:00-17:00, Schedule B: 08:00-19:00</p>
      <p className="subtle">Status: {status}</p>

      <div className="toolbar">
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Late Threshold
          <input type="time" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
        </label>
        <button type="button" onClick={saveThreshold}>Save Override</button>
      </div>
    </section>
  );
}
