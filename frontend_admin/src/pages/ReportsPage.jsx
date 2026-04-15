import { useEffect, useState } from "react";
import { api } from "../services/api";

function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [month, setMonth] = useState(getCurrentMonth());
  const [summary, setSummary] = useState([]);
  const [lateRows, setLateRows] = useState([]);
  const [overtimeRows, setOvertimeRows] = useState([]);
  const [status, setStatus] = useState("Ready");

  async function loadReports() {
    setStatus("Loading reports...");
    try {
      const [monthlySummary, lateReport, overtimeReport] = await Promise.all([
        api.getMonthlySummary(month),
        api.getLateReport(month),
        api.getOvertimeReport(month)
      ]);
      setSummary(monthlySummary);
      setLateRows(lateReport);
      setOvertimeRows(overtimeReport);
      setStatus("Ready");
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => {
    loadReports();
  }, [month]);

  async function exportFile(format) {
    try {
      const blob = await api.exportReport(format, month);
      const extension = format === "xlsx" ? "xlsx" : "csv";
      downloadBlob(blob, `dtr-report-${month}.${extension}`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <section className="card">
      <h2>Reports and Exports</h2>
      <p className="subtle">Status: {status}</p>

      <div className="toolbar">
        <label>
          Month
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <button type="button" onClick={() => exportFile("csv")}>Export CSV</button>
        <button type="button" onClick={() => exportFile("xlsx")}>Export Excel</button>
      </div>

      <h3>Monthly Attendance Summary</h3>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Category</th>
              <th>Days Worked</th>
              <th>Total Late (min)</th>
              <th>Total OT (min)</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((row, index) => (
              <tr key={`${row.employee_name}-${index}`}>
                <td>{row.employee_name}</td>
                <td>{row.category}</td>
                <td>{row.days_worked}</td>
                <td>{row.total_late_minutes}</td>
                <td>{row.total_overtime_minutes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Late Report</h3>
      <ul className="report-list">
        {lateRows.map((row, index) => (
          <li key={`${row.employee_name}-${row.date}-${index}`}>
            {row.date} | {row.employee_name} | {row.late_minutes} min late
          </li>
        ))}
      </ul>

      <h3>Overtime Report</h3>
      <ul className="report-list">
        {overtimeRows.map((row, index) => (
          <li key={`${row.employee_name}-${row.date}-${index}`}>
            {row.date} | {row.employee_name} | {row.overtime_minutes} min overtime
          </li>
        ))}
      </ul>
    </section>
  );
}
