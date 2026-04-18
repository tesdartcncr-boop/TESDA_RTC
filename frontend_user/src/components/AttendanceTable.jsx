export default function AttendanceTable({ rows, onCellUpdate }) {
  function isLeaveCode(value) {
    return ["SL", "VL", "OB"].includes((value || "").trim().toUpperCase());
  }

  function formatTime(value) {
    if (!value || isLeaveCode(value)) {
      return "-";
    }

    return value;
  }

  function formatDuration(minutes) {
    const totalMinutes = Math.max(Number(minutes) || 0, 0);
    const hours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;
    return `${hours}:${String(remainingMinutes).padStart(2, "0")}`;
  }

  if (!rows.length) {
    return <p className="empty-state">No attendance records for the selected date.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="attendance-table">
        <thead>
          <tr>
            <th scope="col">Employee Name</th>
            <th scope="col">Time In</th>
            <th scope="col">Time Out</th>
            <th scope="col">Late (h:mm)</th>
            <th scope="col">Undertime (h:mm)</th>
            <th scope="col">Leave Type</th>
            <th scope="col">Schedule Type</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id} style={{ "--row-index": index }}>
              <td>{row.employee_name}</td>
              <td>
                <span className="readonly-cell">{formatTime(row.time_in)}</span>
              </td>
              <td>
                <span className="readonly-cell">{formatTime(row.time_out)}</span>
              </td>
              <td>{formatDuration(row.late_minutes)}</td>
              <td>{formatDuration(row.undertime_minutes)}</td>
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
