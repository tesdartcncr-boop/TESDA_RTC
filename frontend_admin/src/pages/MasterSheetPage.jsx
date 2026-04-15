import { useEffect, useState } from "react";
import { api } from "../services/api";

function getTodayDate() {
  return new Date().toISOString().split("T")[0];
}

export default function MasterSheetPage() {
  const [date, setDate] = useState(getTodayDate());
  const [category, setCategory] = useState("all");
  const [employee, setEmployee] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("Ready");

  async function loadRecords() {
    setStatus("Loading master records...");
    try {
      const data = await api.getMasterAttendance({
        date,
        category,
        employee,
        search
      });
      setRows(data);
      setStatus("Ready");
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => {
    loadRecords();
  }, [date, category, employee, search]);

  return (
    <section className="card">
      <h2>Master Record Sheet</h2>
      <p className="subtle">Status: {status}</p>
      <div className="toolbar filter-grid">
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All</option>
            <option value="regular">Regular</option>
            <option value="jo">JO</option>
          </select>
        </label>
        <label>
          Employee
          <input value={employee} onChange={(event) => setEmployee(event.target.value)} placeholder="Employee name" />
        </label>
        <label>
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search all fields" />
        </label>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee</th>
              <th>Category</th>
              <th>Time In</th>
              <th>Time Out</th>
              <th>Late</th>
              <th>OT</th>
              <th>Leave</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.date}</td>
                <td>{row.employee_name}</td>
                <td>{row.category}</td>
                <td>{row.time_in || "-"}</td>
                <td>{row.time_out || "-"}</td>
                <td>{row.late_minutes ?? 0}</td>
                <td>{row.overtime_minutes ?? 0}</td>
                <td>{row.leave_type || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
