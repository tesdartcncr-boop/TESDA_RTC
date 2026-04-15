import { useState } from "react";

export default function EmployeeGrid({ employees, onClock }) {
  const [passwords, setPasswords] = useState({});

  if (!employees.length) {
    return <p className="empty-state">No employees found for this category.</p>;
  }

  async function handleClock(employeeId) {
    await onClock(employeeId, passwords[employeeId] || "");
    setPasswords((prev) => ({ ...prev, [employeeId]: "" }));
  }

  return (
    <div className="employee-grid">
      {employees.map((employee) => (
        <article className="employee-card" key={employee.id}>
          <div className="employee-card__copy">
            <span className="employee-badge">{employee.category === "regular" ? "Regular" : "JO"}</span>
            <h3>{employee.name}</h3>
            <p>{employee.category === "regular" ? "Permanent roster" : "Job order roster"}</p>
          </div>
          <label className="employee-password-field">
            <span>Password</span>
            <input
              type="password"
              placeholder="Enter employee password"
              value={passwords[employee.id] || ""}
              onChange={(event) => setPasswords((prev) => ({ ...prev, [employee.id]: event.target.value }))}
            />
          </label>
          <button type="button" className="primary-btn" onClick={() => handleClock(employee.id)}>
            Time In / Time Out
          </button>
        </article>
      ))}
    </div>
  );
}
