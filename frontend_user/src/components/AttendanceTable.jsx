export default function AttendanceTable({ rows, onCellUpdate }) {
  if (!rows.length) {
    return <p className="empty-state">No attendance records for the selected date.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Employee Name</th>
            <th scope="col">Time In</th>
            <th scope="col">Time Out</th>
            <th scope="col">Late</th>
            <th scope="col">Undertime</th>
            <th scope="col">Overtime</th>
            <th scope="col">Leave Type</th>
            <th scope="col">Schedule Type</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.employee_name}</td>
              <td>
                <input
                  aria-label={`Time in for ${row.employee_name}`}
                  value={row.time_in || ""}
                  onChange={(event) => onCellUpdate(row.id, "time_in", event.target.value)}
                />
              </td>
              <td>
                <input
                  aria-label={`Time out for ${row.employee_name}`}
                  value={row.time_out || ""}
                  onChange={(event) => onCellUpdate(row.id, "time_out", event.target.value)}
                />
              </td>
              <td>{row.late_minutes ?? 0}</td>
              <td>{row.undertime_minutes ?? 0}</td>
              <td>{row.overtime_minutes ?? 0}</td>
              <td>
                <input
                  aria-label={`Leave type for ${row.employee_name}`}
                  value={row.leave_type || ""}
                  onChange={(event) => onCellUpdate(row.id, "leave_type", event.target.value)}
                />
              </td>
              <td>
                <input
                  aria-label={`Schedule type for ${row.employee_name}`}
                  value={row.schedule_type || ""}
                  onChange={(event) => onCellUpdate(row.id, "schedule_type", event.target.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
