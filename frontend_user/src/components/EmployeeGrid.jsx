export default function EmployeeGrid({ employees, onClock }) {
  if (!employees.length) {
    return <p className="empty-state">No employees found for this category.</p>;
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
          <button type="button" className="primary-btn" onClick={() => onClock(employee.id)}>
            Time In / Time Out
          </button>
        </article>
      ))}
    </div>
  );
}
