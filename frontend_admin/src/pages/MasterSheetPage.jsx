import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";

function getCurrentMonthRange() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10)
  };
}

function buildRecordKey(employeeId, date) {
  return `${employeeId}:${date}`;
}

function isLeaveCode(value) {
  return ["SL", "VL", "OB"].includes((value || "").trim().toUpperCase());
}

function getDisplayValue(record, field) {
  if (!record) {
    return "";
  }

  const leaveType = (record.leave_type || "").trim().toUpperCase();
  const value = record[field] || "";

  if (field === "time_in") {
    if (leaveType) {
      return leaveType;
    }

    if (isLeaveCode(value)) {
      return value;
    }
  }

  if (field === "time_out" && isLeaveCode(value)) {
    return value;
  }

  return value;
}

function createDraft(record, employeeId, date) {
  return {
    employee_id: employeeId,
    date,
    time_in: getDisplayValue(record, "time_in"),
    time_out: getDisplayValue(record, "time_out"),
    schedule_type: record?.schedule_type || "A"
  };
}

function normalizeInputValue(value) {
  return (value || "").toUpperCase();
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

export default function MasterSheetPage() {
  const defaultRange = getCurrentMonthRange();
  const [rangeDraft, setRangeDraft] = useState(defaultRange);
  const [activeRange, setActiveRange] = useState(defaultRange);
  const [category, setCategory] = useState("all");
  const [title, setTitle] = useState("");
  const [employees, setEmployees] = useState([]);
  const [dates, setDates] = useState([]);
  const [records, setRecords] = useState([]);
  const [draftsByKey, setDraftsByKey] = useState({});
  const [status, setStatus] = useState("Ready");

  const recordsByKey = useMemo(() => {
    return Object.fromEntries(records.map((record) => [buildRecordKey(record.employee_id, record.date), record]));
  }, [records]);

  useEffect(() => {
    let mounted = true;

    async function loadSheet() {
      setStatus("Loading master sheet...");
      try {
        const data = await api.getMasterSheet({
          date_from: activeRange.from,
          date_to: activeRange.to,
          category
        });

        if (!mounted) {
          return;
        }

        setTitle(data.title || "");
        setEmployees(data.employees || []);
        setDates(data.dates || []);
        setRecords(data.records || []);
        setDraftsByKey({});
        setStatus("Ready");
      } catch (error) {
        if (mounted) {
          setStatus(error.message);
        }
      }
    }

    loadSheet();

    return () => {
      mounted = false;
    };
  }, [activeRange.from, activeRange.to, category]);

  function updateDraft(employeeId, date, field, value) {
    const key = buildRecordKey(employeeId, date);
    const record = recordsByKey[key];

    setDraftsByKey((prev) => {
      const current = prev[key] || createDraft(record, employeeId, date);
      return {
        ...prev,
        [key]: {
          ...current,
          [field]: normalizeInputValue(value)
        }
      };
    });
  }

  async function saveDraft(employeeId, date, draftOverride) {
    const key = buildRecordKey(employeeId, date);
    const draft = draftOverride || draftsByKey[key];
    if (!draft) {
      return;
    }

    const timeIn = (draft.time_in || "").trim();
    const timeOut = (draft.time_out || "").trim();
    const existingRecord = recordsByKey[key];

    if (!existingRecord && !timeIn && !timeOut) {
      setDraftsByKey((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }

    setStatus("Saving master sheet...");
    try {
      const updated = await api.saveMasterSheetRecord({
        employee_id: employeeId,
        date,
        time_in: timeIn || null,
        time_out: timeOut || null,
        schedule_type: draft.schedule_type || existingRecord?.schedule_type || "A"
      });

      setRecords((prev) => {
        const next = prev.filter((record) => record.id !== updated.id);
        return [...next, updated].sort((left, right) => {
          if (left.date !== right.date) {
            return left.date.localeCompare(right.date);
          }

          return String(left.employee_name || "").localeCompare(String(right.employee_name || ""));
        });
      });

      setDraftsByKey((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setStatus("Attendance record saved");
    } catch (error) {
      setStatus(error.message);
    }
  }

  function applyRange() {
    if (rangeDraft.from > rangeDraft.to) {
      setStatus("The from date must be earlier than or equal to the to date.");
      return;
    }

    setActiveRange(rangeDraft);
  }

  async function exportExcel() {
    try {
      setStatus("Preparing Excel export...");
      const blob = await api.exportMasterSheet({
        date_from: activeRange.from,
        date_to: activeRange.to,
        category
      });
      downloadBlob(blob, `master-sheet-${activeRange.from}-to-${activeRange.to}.xlsx`);
      setStatus("Excel export ready");
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <section className="card master-sheet-card">
      <div className="master-sheet-header">
        <div>
          <h2>Master Record Sheet</h2>
          <p className="subtle">Status: {status}</p>
        </div>
        <button type="button" onClick={exportExcel}>Export Excel</button>
      </div>

      <div className="toolbar master-sheet-toolbar">
        <label>
          From
          <input
            type="date"
            value={rangeDraft.from}
            onChange={(event) => setRangeDraft((prev) => ({ ...prev, from: event.target.value }))}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={rangeDraft.to}
            onChange={(event) => setRangeDraft((prev) => ({ ...prev, to: event.target.value }))}
          />
        </label>
        <label>
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="all">All</option>
            <option value="regular">Regular</option>
            <option value="jo">JO</option>
          </select>
        </label>
        <button type="button" onClick={applyRange}>View Range</button>
      </div>

      <p className="subtle master-sheet-note">
        Displaying {title || `${activeRange.from} to ${activeRange.to}`}. Employee headers use surnames only.
      </p>

      <div className="master-sheet-scroll table-container">
        <table className="master-sheet-table">
          <thead>
            <tr>
              <th rowSpan="2" className="master-sheet-date-col">DATE</th>
              <th rowSpan="2" className="master-sheet-day-col">DAY</th>
              {employees.map((employee) => (
                <th key={employee.id} colSpan="2" className="master-sheet-employee-col">
                  {(employee.surname || employee.name || "").toUpperCase()}
                </th>
              ))}
            </tr>
            <tr>
              {employees.map((employee) => (
                <Fragment key={`${employee.id}-subheaders`}>
                  <th className="master-sheet-subheader">IN</th>
                  <th className="master-sheet-subheader">OUT</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((dateInfo) => (
              <tr key={dateInfo.date} className={dateInfo.is_weekend ? "sheet-weekend-row" : ""}>
                <td className={`master-sheet-date-col ${dateInfo.is_monday ? "is-monday" : dateInfo.is_weekend ? "is-weekend" : ""}`}>
                  {dateInfo.label}
                </td>
                <td className={`master-sheet-day-col ${dateInfo.is_monday ? "is-monday" : dateInfo.is_weekend ? "is-weekend" : ""}`}>
                  {dateInfo.weekday}
                </td>
                {employees.map((employee) => {
                  const key = buildRecordKey(employee.id, dateInfo.date);
                  const record = recordsByKey[key];
                  const draft = draftsByKey[key] || createDraft(record, employee.id, dateInfo.date);

                  return (
                    <Fragment key={key}>
                      <td>
                        <input
                          className="master-sheet-input"
                          type="text"
                          value={draft.time_in}
                          spellCheck={false}
                          autoComplete="off"
                          onChange={(event) => updateDraft(employee.id, dateInfo.date, "time_in", event.target.value)}
                          onBlur={() => saveDraft(employee.id, dateInfo.date, draft)}
                        />
                      </td>
                      <td>
                        <input
                          className="master-sheet-input"
                          type="text"
                          value={draft.time_out}
                          spellCheck={false}
                          autoComplete="off"
                          onChange={(event) => updateDraft(employee.id, dateInfo.date, "time_out", event.target.value)}
                          onBlur={() => saveDraft(employee.id, dateInfo.date, draft)}
                        />
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}