import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ScheduleOverridePanel from "../components/ScheduleOverridePanel";
import { api } from "../services/api";

const MANILA_TIME_ZONE = "Asia/Manila";
const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: MANILA_TIME_ZONE,
  month: "long",
  year: "numeric"
});
const DISPLAY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: MANILA_TIME_ZONE,
  month: "long",
  day: "numeric",
  year: "numeric"
});

function getManilaDateParts(referenceDate = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(referenceDate);

  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function getManilaMonth(referenceDate = new Date()) {
  const values = getManilaDateParts(referenceDate);
  return `${values.year}-${values.month}`;
}

function formatMonthLabel(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  return MONTH_LABEL_FORMATTER.format(date);
}

function getMonthRange(monthValue) {
  const [year, month] = monthValue.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();

  return {
    date_from: `${year}-${String(month).padStart(2, "0")}-01`,
    date_to: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  };
}

function buildMonthOptions(referenceDate = new Date(), monthsBack = 36, monthsForward = 36) {
  const values = getManilaDateParts(referenceDate);
  const startDate = new Date(Date.UTC(Number(values.year), Number(values.month) - monthsBack, 1, 12, 0, 0));
  const totalMonths = monthsBack + monthsForward + 1;

  return Array.from({ length: totalMonths }, (_, index) => {
    const date = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + index, 1, 12, 0, 0));
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

    return {
      value,
      label: formatMonthLabel(value)
    };
  });
}

function formatDisplayDate(dateIso) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return DISPLAY_DATE_FORMATTER.format(date);
}

function formatPeriodLabel(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) {
    return "Selected period";
  }

  if (dateFrom === dateTo) {
    return formatDisplayDate(dateFrom);
  }

  return `${formatDisplayDate(dateFrom)} - ${formatDisplayDate(dateTo)}`;
}

function formatEmployeeSheetDate(dateIso) {
  const [year, month, day] = dateIso.split("-").map(Number);
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${String(year).slice(-2)}`;
}

function formatDuration(minutes) {
  const totalMinutes = Math.max(Number(minutes || 0), 0);
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  return `${hours}:${String(remainingMinutes).padStart(2, "0")}`;
}

function parseTimeTokenToMinutes(value) {
  const token = String(value || "").trim().toUpperCase();
  if (!token || isLeaveCode(token)) {
    return null;
  }

  const twentyFourHourMatch = token.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (twentyFourHourMatch) {
    return Number(twentyFourHourMatch[1]) * 60 + Number(twentyFourHourMatch[2]);
  }

  const twelveHourMatch = token.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*(AM|PM)$/);
  if (twelveHourMatch) {
    let hours = Number(twelveHourMatch[1]) % 12;
    if (twelveHourMatch[3] === "PM") {
      hours += 12;
    }

    return hours * 60 + Number(twelveHourMatch[2]);
  }

  return null;
}

function calculateWorkedMinutes(startMinutes, endMinutes) {
  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  const lunchStartMinutes = 12 * 60;
  const lunchEndMinutes = 13 * 60;
  const grossMinutes = Math.max(endMinutes - startMinutes, 0);
  const lunchOverlapStart = Math.max(startMinutes, lunchStartMinutes);
  const lunchOverlapEnd = Math.min(endMinutes, lunchEndMinutes);
  const lunchOverlapMinutes = Math.max(lunchOverlapEnd - lunchOverlapStart, 0);

  return Math.max(grossMinutes - lunchOverlapMinutes, 0);
}

function formatTotalHours(record) {
  if (!record) {
    return "—";
  }

  const leaveType = String(record.leave_type || "").trim().toUpperCase();
  const timeInToken = String(record.time_in || "").trim().toUpperCase();
  const timeOutToken = String(record.time_out || "").trim().toUpperCase();
  const isObRecord = leaveType === "OB" || timeInToken === "OB" || timeOutToken === "OB";

  if (leaveType && leaveType !== "OB") {
    return "—";
  }

  const scheduleType = String(record.schedule_type || "A").trim().toUpperCase();
  const requiredMinutes = Number(record.required_minutes || (scheduleType === "B" ? 600 : 480));
  const category = String(record.category || "").trim().toLowerCase();
  const recordFloorMinutes = category === "jo" ? 8 * 60 : 7 * 60;

  if (isObRecord) {
    if (!timeOutToken) {
      return formatDuration(requiredMinutes);
    }

    const effectiveTimeInMinutes = timeInToken && timeInToken !== "OB"
      ? Math.max(parseTimeTokenToMinutes(record.time_in) || recordFloorMinutes, recordFloorMinutes)
      : recordFloorMinutes;
    const scheduleEndMinutes = requiredMinutes >= 600 ? 19 * 60 : 17 * 60;
    const timeOutMinutes = timeOutToken === "OB" ? scheduleEndMinutes : parseTimeTokenToMinutes(record.time_out);
    if (timeOutMinutes === null) {
      return formatDuration(requiredMinutes);
    }

    const workedMinutes = calculateWorkedMinutes(effectiveTimeInMinutes, timeOutMinutes);
    return formatDuration(Math.max(Math.min(workedMinutes, requiredMinutes), 0));
  }

  const timeInMinutes = parseTimeTokenToMinutes(record.time_in);
  const timeOutMinutes = parseTimeTokenToMinutes(record.time_out);
  if (timeInMinutes === null || timeOutMinutes === null) {
    return "—";
  }

  const workedMinutes = calculateWorkedMinutes(timeInMinutes, timeOutMinutes);

  const totalMinutes = Math.max(Math.min(workedMinutes, requiredMinutes), 0);
  return formatDuration(totalMinutes);
}

function formatPlaceholder(value, fallback = "N/A") {
  const token = String(value || "").trim();
  return token || fallback;
}

function composeEmployeeFirstName(employee, fallback = "N/A") {
  const firstName = (employee.first_name || "").trim();
  const secondName = (employee.second_name || "").trim();

  if (!firstName) {
    return formatPlaceholder(employee.display_name || employee.name, fallback);
  }

  if (!secondName) {
    return firstName;
  }

  if (secondName.length <= 2) {
    return `${firstName} ${secondName.replace(/\./g, "").toUpperCase()}.`.trim();
  }

  if (secondName.split(/\s+/).length === 1) {
    return `${firstName} ${secondName[0].toUpperCase()}.`.trim();
  }

  return `${firstName} ${secondName}`.trim();
}

function composeEmployeeSignatureName(employee, fallback = "N/A") {
  const firstName = (employee.first_name || "").trim();
  const lastName = (employee.last_name || employee.surname || "").trim();

  if (firstName && lastName) {
    return `${firstName} ${lastName}`.trim();
  }

  if (firstName) {
    return firstName;
  }

  if (lastName) {
    return lastName;
  }

  return formatPlaceholder(employee.display_name || employee.name, fallback);
}

function getEmployeeOffice(employee) {
  return (employee.office || employee.district_office || "").trim().toUpperCase();
}

function buildEmployeePreviewRows(employee, dates, recordsByKey) {
  return dates.map((dateInfo) => {
    const record = recordsByKey[buildRecordKey(employee.id, dateInfo.date)];

    return {
      date: formatEmployeeSheetDate(dateInfo.date),
      day: dateInfo.weekday || "",
      time_in: formatPlaceholder(record?.display_time_in || getDisplayValue(record, "time_in"), "—"),
      time_out: formatPlaceholder(record?.display_time_out || getDisplayValue(record, "time_out"), "—"),
      late: record ? formatDuration(record.late_minutes) : "—",
      undertime: record ? formatDuration(record.undertime_minutes) : "—",
      remarks: formatPlaceholder(record?.remarks, "—"),
      total_hours: formatTotalHours(record),
      is_weekend: Boolean(dateInfo.is_weekend),
      is_monday: Boolean(dateInfo.is_monday)
    };
  });
}

function getCategoryLabel(category) {
  return category === "regular" ? "Regular" : "Job Order";
}

function getEmployeeSheetTabLabel(employee) {
  return (employee.surname || employee.last_name || employee.name || employee.display_name || "Employee").trim();
}

function sortEmployeeSheetTabs(employees = []) {
  return [...employees].sort((left, right) => {
    const leftLabel = getEmployeeSheetTabLabel(left);
    const rightLabel = getEmployeeSheetTabLabel(right);
    const labelOrder = leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" });
    if (labelOrder !== 0) {
      return labelOrder;
    }

    return String(left.employee_no || left.id || "").localeCompare(String(right.employee_no || right.id || ""), undefined, {
      sensitivity: "base",
      numeric: true
    });
  });
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

function createEmptySheetState() {
  return {
    title: "",
    employees: [],
    dates: [],
    records: [],
    draftsByKey: {},
    status: "Ready",
    loadedRangeKey: ""
  };
}

function updateCategorySheetState(setSheetStateByCategory, category, updater) {
  setSheetStateByCategory((prev) => {
    const current = prev[category] || createEmptySheetState();
    const patch = typeof updater === "function" ? updater(current) : updater;

    return {
      ...prev,
      [category]: {
        ...current,
        ...patch
      }
    };
  });
}

function EmployeeSurnameSheet({ employee, periodLabel, rows, className = "", compact = false }) {
  const employeeNo = formatPlaceholder(String(employee.employee_no || employee.id || "").trim());
  const lastName = formatPlaceholder((employee.surname || employee.last_name || employee.name || employee.display_name || "").trim().toUpperCase());
  const displayName = formatPlaceholder((employee.display_name || employee.name || "").trim().toUpperCase());
  const firstName = composeEmployeeFirstName(employee, "N/A").toUpperCase();
  const signatureName = composeEmployeeSignatureName(employee, "N/A").toUpperCase();
  const office = formatPlaceholder(getEmployeeOffice(employee));

  return (
    <article className={`card master-sheet-surname-sheet ${compact ? "master-sheet-surname-sheet--compact" : ""} ${className}`.trim()}>
      {!compact ? (
        <header className="master-sheet-surname-sheet__header">
          <p className="section-kicker">Employee Sheet</p>
          <h4>{lastName}</h4>
          <p className="subtle">No. {employeeNo || "-"} · {displayName}</p>
        </header>
      ) : null}

      <div className="master-sheet-surname-sheet__page">
        {!compact ? (
          <div className="master-sheet-surname-sheet__page-header">
            <p className="master-sheet-surname-sheet__institution">TECHNICAL EDUCATION AND SKILLS DEVELOPMENT AUTHORITY (TESDA)</p>
            <p className="master-sheet-surname-sheet__subinstitution">National Capital Region - MuniPalasTaPat</p>
            <h5>DAILY TIME RECORD</h5>
            <p className="master-sheet-surname-sheet__period">{periodLabel}</p>
          </div>
        ) : null}

        {!compact ? (
          <div className="master-sheet-surname-sheet__info-grid">
            <div>
              <span>Employee No.</span>
              <strong>{employeeNo}</strong>
            </div>
            <div>
              <span>Last Name</span>
              <strong>{lastName}</strong>
            </div>
            <div>
              <span>First Name</span>
              <strong>{firstName}</strong>
            </div>
            <div>
              <span>District Office</span>
              <strong>{office}</strong>
            </div>
          </div>
        ) : null}

        <div className="master-sheet-surname-sheet__table-shell">
          <table className="master-sheet-surname-sheet__table">
            <colgroup>
              <col className="master-sheet-surname-sheet__date-col" />
              <col className="master-sheet-surname-sheet__day-col" />
              <col className="master-sheet-surname-sheet__time-col" />
              <col className="master-sheet-surname-sheet__time-col" />
              <col className="master-sheet-surname-sheet__time-col" />
              <col className="master-sheet-surname-sheet__time-col" />
              <col className="master-sheet-surname-sheet__remarks-col" />
              <col className="master-sheet-surname-sheet__total-hours-col" />
            </colgroup>
            <thead>
              <tr>
                <th>DATE</th>
                <th>DAY</th>
                <th>TIME-IN</th>
                <th>TIME-OUT</th>
                <th>LATE</th>
                <th>UNDERTIME</th>
                <th>REMARKS</th>
                <th>TOTAL HOURS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.date} style={{ "--row-index": index }}>
                  <td className={row.is_weekend ? "master-sheet-surname-sheet__date--weekend" : row.is_monday ? "master-sheet-surname-sheet__date--monday" : ""}>
                    {row.date}
                  </td>
                  <td className={row.is_weekend ? "master-sheet-surname-sheet__day--weekend" : row.is_monday ? "master-sheet-surname-sheet__day--monday" : ""}>
                    {row.day}
                  </td>
                  <td>{row.time_in}</td>
                  <td>{row.time_out}</td>
                  <td>{row.late}</td>
                  <td>{row.undertime}</td>
                  <td className="master-sheet-surname-sheet__remarks">{row.remarks}</td>
                  <td>{row.total_hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!compact ? (
          <div className="master-sheet-surname-sheet__footer">
            <p className="master-sheet-surname-sheet__statement">
              I CERTIFY on my honor that the above is a true and correct report of the hours of work performed, record of which was made daily at the time of arrival at and departure from office.
            </p>
            <div className="master-sheet-surname-sheet__signatures">
              <div>
                <strong>{signatureName}</strong>
                <span>Name/Signature</span>
              </div>
              <div>
                <strong>{formatPlaceholder("GERARDO A. MERCADO")}</strong>
                <span>Head of Office</span>
                <span>Name/Signature</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function MasterSheetEmployeeSheetModal({
  category,
  categoryLabel,
  periodLabel,
  employees,
  selectedEmployeeId,
  setSelectedEmployeeId,
  rowsByEmployee,
  onClose
}) {
  const [liveEmployees, setLiveEmployees] = useState(employees);
  const sortedEmployees = useMemo(() => sortEmployeeSheetTabs(liveEmployees), [liveEmployees]);

  useEffect(() => {
    setLiveEmployees(employees);
  }, [employees]);

  useEffect(() => {
    let cancelled = false;

    async function refreshEmployees() {
      try {
        const rows = await api.getEmployees(category);
        if (!cancelled && Array.isArray(rows)) {
          setLiveEmployees(rows);
        }
      } catch {
        if (!cancelled) {
          setLiveEmployees(employees);
        }
      }
    }

    refreshEmployees();

    return () => {
      cancelled = true;
    };
  }, [category, employees]);

  const selectedEmployee = useMemo(() => {
    if (!sortedEmployees.length) {
      return null;
    }

    if (selectedEmployeeId) {
      return sortedEmployees.find((employee) => employee.id === selectedEmployeeId) || sortedEmployees[0];
    }

    return sortedEmployees[0];
  }, [selectedEmployeeId, sortedEmployees]);

  const selectedRows = selectedEmployee ? rowsByEmployee?.[selectedEmployee.id] || [] : [];

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape" && typeof onClose === "function") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function handleClose() {
    if (typeof onClose === "function") {
      onClose();
    }
  }

  const panel = (
    <section className="card master-sheet-date-modal__dialog master-sheet-employee-sheet-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="master-sheet-employee-sheet-title">
      <header className="master-sheet-date-modal__header master-sheet-employee-sheet-modal__header">
        <div className="master-sheet-date-modal__heading">
          <p className="section-kicker">{categoryLabel} employee sheet</p>
          <h3 id="master-sheet-employee-sheet-title">{selectedEmployee ? (selectedEmployee.surname || selectedEmployee.last_name || selectedEmployee.name || selectedEmployee.display_name || "Employee Sheet") : "Employee Sheet"}</h3>
          <p className="subtle">No. {selectedEmployee ? (selectedEmployee.employee_no || selectedEmployee.id || "-") : "-"} · {periodLabel}</p>
        </div>

        <div className="master-sheet-date-modal__header-actions">
          <button type="button" className="secondary-btn master-sheet-date-modal__close" onClick={handleClose}>
            Close
          </button>
        </div>
      </header>

      <div className="master-sheet-employee-sheet-modal__body">
        {selectedEmployee ? (
          <div className="master-sheet-employee-sheet-modal__preview">
            <EmployeeSurnameSheet
              employee={selectedEmployee}
              periodLabel={periodLabel}
              rows={selectedRows}
              className="master-sheet-surname-sheet--modal"
                compact
            />
          </div>
        ) : (
          <p className="subtle master-sheet-date-modal__empty">No employees are available for this category yet.</p>
        )}

        <div className="master-sheet-surname-tabs master-sheet-employee-sheet-modal__tabs" role="tablist" aria-label="Employee sheet tabs">
          {sortedEmployees.map((employee) => {
            const isSelected = selectedEmployee?.id === employee.id;
            const tabLabel = getEmployeeSheetTabLabel(employee).toUpperCase();

            return (
              <button
                key={employee.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                className={isSelected ? "mini-tab active" : "mini-tab"}
                onClick={() => setSelectedEmployeeId(employee.id)}
              >
                {tabLabel}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );

  if (typeof document === "undefined" || !document.body) {
    return panel;
  }

  return createPortal(
    <div className="schedule-override-modal master-sheet-date-modal master-sheet-employee-sheet-modal" role="presentation" onClick={handleClose}>
      <div className="master-sheet-modal__surface master-sheet-employee-sheet-modal__surface" role="presentation" onClick={(event) => event.stopPropagation()}>
        {panel}
      </div>
    </div>,
    document.body
  );
}

function MasterSheetDateEditorModal({
  date,
  category,
  categoryLabel,
  employees,
  recordsByKey,
  draftsByKey,
  updateDraft,
  saveDraft,
  onClose
}) {
  const [activeTab, setActiveTab] = useState("attendance");
  const autoSaveTimersRef = useRef(new Map());
  const saveDraftRef = useRef(saveDraft);
  const dateLabel = formatDisplayDate(date);

  const attendanceRows = useMemo(() => {
    return (employees || []).map((employee) => {
      const key = buildRecordKey(employee.id, date);
      const record = recordsByKey[key];
      const draft = draftsByKey?.[key] || createDraft(record, employee.id, date);

      return {
        key,
        employee,
        record,
        draft
      };
    });
  }, [date, draftsByKey, employees, recordsByKey]);

  useEffect(() => {
    saveDraftRef.current = saveDraft;
  }, [saveDraft]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape" && typeof onClose === "function") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  useEffect(() => {
    return () => {
      autoSaveTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      autoSaveTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    attendanceRows.forEach(({ key, employee, draft, record }) => {
      const draftTimeIn = (draft.time_in || "").trim();
      const draftTimeOut = (draft.time_out || "").trim();
      const recordTimeIn = (getDisplayValue(record, "time_in") || "").trim();
      const recordTimeOut = (getDisplayValue(record, "time_out") || "").trim();
      const isDirty = draftTimeIn !== recordTimeIn || draftTimeOut !== recordTimeOut;
      const existingTimer = autoSaveTimersRef.current.get(key);

      if (!isDirty) {
        if (existingTimer) {
          window.clearTimeout(existingTimer);
          autoSaveTimersRef.current.delete(key);
        }

        return;
      }

      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      const timeoutId = window.setTimeout(() => {
        autoSaveTimersRef.current.delete(key);
        saveDraftRef.current(employee.id, date, { silent: true });
      }, 650);

      autoSaveTimersRef.current.set(key, timeoutId);
    });
  }, [attendanceRows, date]);

  function flushAutoSave(employeeId) {
    const key = buildRecordKey(employeeId, date);
    const existingTimer = autoSaveTimersRef.current.get(key);

    if (existingTimer) {
      window.clearTimeout(existingTimer);
      autoSaveTimersRef.current.delete(key);
    }

    saveDraftRef.current(employeeId, date, { silent: true });
  }

  function handleClose() {
    if (typeof onClose === "function") {
      onClose();
    }
  }

  const panel = (
    <section className="card master-sheet-date-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="master-sheet-date-modal-title">
      <header className="master-sheet-date-modal__header">
        <div className="master-sheet-date-modal__heading">
          <p className="section-kicker">{categoryLabel} master sheet</p>
          <h3 id="master-sheet-date-modal-title">{dateLabel}</h3>
          <p className="subtle">Attendance edits auto-save after a short pause.</p>
        </div>

        <div className="master-sheet-date-modal__header-actions">
          <div className="tab-cluster" role="tablist" aria-label="Date editor tabs">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "attendance"}
              className={activeTab === "attendance" ? "mini-tab active" : "mini-tab"}
              onClick={() => setActiveTab("attendance")}
            >
              Attendance
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "schedule"}
              className={activeTab === "schedule" ? "mini-tab active" : "mini-tab"}
              onClick={() => setActiveTab("schedule")}
            >
              Day Rule
            </button>
          </div>

          <button type="button" className="secondary-btn master-sheet-date-modal__close" onClick={handleClose}>
            Close
          </button>
        </div>
      </header>

      <div className="master-sheet-date-modal__body">
        {activeTab === "attendance" ? (
          <section className="master-sheet-date-modal__attendance">
            <p className="subtle master-sheet-date-modal__hint">
              Names listed below come from the current category roster. Enter a time or leave code and the cell will save automatically.
            </p>

            {attendanceRows.length ? (
              <div className="master-sheet-date-modal__table-shell">
                <table className="master-sheet-date-modal__table">
                  <colgroup>
                    <col className="master-sheet-date-modal__employee-col" />
                    <col className="master-sheet-date-modal__time-col" />
                    <col className="master-sheet-date-modal__time-col" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>EMPLOYEE</th>
                      <th>TIME IN</th>
                      <th>TIME OUT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceRows.map(({ key, employee, draft }) => {
                      const employeeName = formatPlaceholder(employee.display_name || employee.name || employee.surname || "", "Unknown Employee");
                      const employeeHint = formatPlaceholder(employee.surname || employee.name || "", "");

                      return (
                        <tr key={key}>
                          <td className="master-sheet-date-modal__employee-cell">
                            <strong>{employeeName}</strong>
                            {employeeHint && employeeHint !== employeeName ? <span>{employeeHint}</span> : null}
                          </td>
                          <td>
                            <input
                              className="master-sheet-input master-sheet-date-modal__input"
                              type="text"
                              value={draft.time_in}
                              spellCheck={false}
                              autoComplete="off"
                              placeholder="08:00 or SL"
                              onChange={(event) => updateDraft(employee.id, date, "time_in", event.target.value)}
                              onBlur={() => flushAutoSave(employee.id)}
                            />
                          </td>
                          <td>
                            <input
                              className="master-sheet-input master-sheet-date-modal__input"
                              type="text"
                              value={draft.time_out}
                              spellCheck={false}
                              autoComplete="off"
                              placeholder="17:00 or VL"
                              onChange={(event) => updateDraft(employee.id, date, "time_out", event.target.value)}
                              onBlur={() => flushAutoSave(employee.id)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="subtle master-sheet-date-modal__empty">No employees are available for this category yet.</p>
            )}
          </section>
        ) : (
          <section className="master-sheet-date-modal__schedule">
            <ScheduleOverridePanel
              title="Day Rule"
              description={`Editing ${dateLabel}. Saving updates the schedule for this date.`}
              saveLabel="Save Day Rule"
              initialDate={date}
              category={category}
              showDateField={false}
            />
          </section>
        )}
      </div>
    </section>
  );

  if (typeof document === "undefined" || !document.body) {
    return panel;
  }

  return createPortal(
    <div className="schedule-override-modal master-sheet-date-modal" role="presentation" onClick={handleClose}>
      <div className="master-sheet-modal__surface" role="presentation" onClick={(event) => event.stopPropagation()}>
        {panel}
      </div>
    </div>,
    document.body
  );
}

function MasterSheetEmployeeEditorModal({
  employee,
  categoryLabel,
  periodLabel,
  dates,
  recordsByKey,
  draftsByKey,
  updateDraft,
  saveDraft,
  onClose
}) {
  const activeTab = "monthly";
  const autoSaveTimersRef = useRef(new Map());
  const saveDraftRef = useRef(saveDraft);
  const employeeName = formatPlaceholder(employee.display_name || employee.name || employee.surname || "", "Unknown Employee");
  const employeeLabel = formatPlaceholder(employee.surname || employee.name || "", "Monthly time record");

  const monthlyRows = useMemo(() => {
    return (dates || []).map((dateInfo) => {
      const key = buildRecordKey(employee.id, dateInfo.date);
      const record = recordsByKey[key];
      const draft = draftsByKey?.[key] || createDraft(record, employee.id, dateInfo.date);

      return {
        key,
        date: dateInfo.date,
        label: dateInfo.label,
        weekday: dateInfo.weekday || "",
        is_weekend: Boolean(dateInfo.is_weekend),
        is_monday: Boolean(dateInfo.is_monday),
        record,
        draft
      };
    });
  }, [dates, draftsByKey, employee.id, recordsByKey]);

  useEffect(() => {
    saveDraftRef.current = saveDraft;
  }, [saveDraft]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape" && typeof onClose === "function") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  useEffect(() => {
    return () => {
      autoSaveTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      autoSaveTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    monthlyRows.forEach((row) => {
      const draftTimeIn = (row.draft.time_in || "").trim();
      const draftTimeOut = (row.draft.time_out || "").trim();
      const recordTimeIn = (getDisplayValue(row.record, "time_in") || "").trim();
      const recordTimeOut = (getDisplayValue(row.record, "time_out") || "").trim();
      const isDirty = draftTimeIn !== recordTimeIn || draftTimeOut !== recordTimeOut;
      const existingTimer = autoSaveTimersRef.current.get(row.key);

      if (!isDirty) {
        if (existingTimer) {
          window.clearTimeout(existingTimer);
          autoSaveTimersRef.current.delete(row.key);
        }

        return;
      }

      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }

      const timeoutId = window.setTimeout(() => {
        autoSaveTimersRef.current.delete(row.key);
        saveDraftRef.current(employee.id, row.date, { silent: true });
      }, 650);

      autoSaveTimersRef.current.set(row.key, timeoutId);
    });
  }, [employee.id, monthlyRows]);

  function flushAutoSave(date) {
    const key = buildRecordKey(employee.id, date);
    const existingTimer = autoSaveTimersRef.current.get(key);

    if (existingTimer) {
      window.clearTimeout(existingTimer);
      autoSaveTimersRef.current.delete(key);
    }

    saveDraftRef.current(employee.id, date, { silent: true });
  }

  function handleClose() {
    if (typeof onClose === "function") {
      onClose();
    }
  }

  const panel = (
    <section className="card master-sheet-date-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="master-sheet-employee-modal-title">
      <header className="master-sheet-date-modal__header">
        <div className="master-sheet-date-modal__heading">
          <p className="section-kicker">{categoryLabel} monthly record</p>
          <h3 id="master-sheet-employee-modal-title">{employeeName}</h3>
          <p className="subtle">{employeeLabel}</p>
          <p className="subtle">Period: {periodLabel}</p>
          <p className="subtle">Edit the monthly time in/out. Changes auto-save after a short pause.</p>
        </div>

        <div className="master-sheet-date-modal__header-actions">
          <div className="status-pill status-pill--live">{activeTab === "monthly" ? "Editing month" : "Monthly view"}</div>
          <button type="button" className="secondary-btn master-sheet-date-modal__close" onClick={handleClose}>
            Close
          </button>
        </div>
      </header>

      <div className="master-sheet-date-modal__body">
        <section className="master-sheet-date-modal__attendance">
          <p className="subtle master-sheet-date-modal__hint">
            Click into any row, type the new time, then pause or leave the field to save automatically.
          </p>

          {monthlyRows.length ? (
            <div className="master-sheet-date-modal__table-shell">
              <table className="master-sheet-date-modal__table master-sheet-employee-modal__table">
                <colgroup>
                  <col className="master-sheet-employee-modal__date-col" />
                  <col className="master-sheet-employee-modal__day-col" />
                  <col className="master-sheet-date-modal__time-col" />
                  <col className="master-sheet-date-modal__time-col" />
                </colgroup>
                <thead>
                  <tr>
                    <th>DATE</th>
                    <th>DAY</th>
                    <th>TIME IN</th>
                    <th>TIME OUT</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyRows.map((row) => {
                    const dateClass = row.is_weekend
                      ? "master-sheet-surname-sheet__date--weekend"
                      : row.is_monday
                        ? "master-sheet-surname-sheet__date--monday"
                        : "";
                    const dayClass = row.is_weekend
                      ? "master-sheet-surname-sheet__day--weekend"
                      : row.is_monday
                        ? "master-sheet-surname-sheet__day--monday"
                        : "";

                    return (
                      <tr key={row.key}>
                        <td className={dateClass}>{row.label}</td>
                        <td className={dayClass}>{row.weekday}</td>
                        <td>
                          <input
                            className="master-sheet-input master-sheet-date-modal__input"
                            type="text"
                            value={row.draft.time_in}
                            spellCheck={false}
                            autoComplete="off"
                            placeholder="08:00 or SL"
                            onChange={(event) => updateDraft(employee.id, row.date, "time_in", event.target.value)}
                            onBlur={() => flushAutoSave(row.date)}
                          />
                        </td>
                        <td>
                          <input
                            className="master-sheet-input master-sheet-date-modal__input"
                            type="text"
                            value={row.draft.time_out}
                            spellCheck={false}
                            autoComplete="off"
                            placeholder="17:00 or VL"
                            onChange={(event) => updateDraft(employee.id, row.date, "time_out", event.target.value)}
                            onBlur={() => flushAutoSave(row.date)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="subtle master-sheet-date-modal__empty">No dates are available for this month yet.</p>
          )}
        </section>
      </div>
    </section>
  );

  if (typeof document === "undefined" || !document.body) {
    return panel;
  }

  return createPortal(
    <div className="schedule-override-modal master-sheet-date-modal" role="presentation" onClick={handleClose}>
      <div className="master-sheet-modal__surface" role="presentation" onClick={(event) => event.stopPropagation()}>
        {panel}
      </div>
    </div>,
    document.body
  );
}

function MasterSheetCategoryPanel({ category, month, monthLabel, dateRange, sheetState, setSheetState }) {
  const categoryLabel = getCategoryLabel(category);
  const currentRangeKey = `${dateRange.date_from}:${dateRange.date_to}`;
  const tableMinWidth = Math.max(900, 192 + (sheetState.employees.length * 184));
  const periodLabel = formatPeriodLabel(dateRange.date_from, dateRange.date_to);
  const isLoadingSheet = sheetState.status.startsWith("Loading");
  const [sheetView, setSheetView] = useState("master");
  const [isEmployeeSheetOpen, setIsEmployeeSheetOpen] = useState(false);
  const [selectedSurnameEmployeeId, setSelectedSurnameEmployeeId] = useState(null);
  const [selectedDateEditor, setSelectedDateEditor] = useState(null);
  const [selectedEmployeeEditorId, setSelectedEmployeeEditorId] = useState(null);
  const draftVersionRef = useRef(new Map());

  const recordsByKey = useMemo(() => {
    return Object.fromEntries((sheetState.records || []).map((record) => [buildRecordKey(record.employee_id, record.date), record]));
  }, [sheetState.records]);

  const previewRowsByEmployee = useMemo(() => {
    return Object.fromEntries(
      (sheetState.employees || []).map((employee) => [
        employee.id,
        buildEmployeePreviewRows(employee, sheetState.dates || [], recordsByKey)
      ])
    );
  }, [recordsByKey, sheetState.dates, sheetState.employees]);

  const sortedSheetEmployees = useMemo(() => sortEmployeeSheetTabs(sheetState.employees || []), [sheetState.employees]);

  const selectedSurnameEmployee = useMemo(() => {
    if (!sortedSheetEmployees.length) {
      return null;
    }

    return sortedSheetEmployees.find((employee) => employee.id === selectedSurnameEmployeeId) || sortedSheetEmployees[0];
  }, [selectedSurnameEmployeeId, sortedSheetEmployees]);

  const selectedEmployeeEditor = useMemo(() => {
    if (!selectedEmployeeEditorId) {
      return null;
    }

    return sheetState.employees.find((employee) => employee.id === selectedEmployeeEditorId) || null;
  }, [selectedEmployeeEditorId, sheetState.employees]);

  useEffect(() => {
    if (!sortedSheetEmployees.length) {
      setSelectedSurnameEmployeeId(null);
      return;
    }

    if (!sortedSheetEmployees.some((employee) => employee.id === selectedSurnameEmployeeId)) {
      setSelectedSurnameEmployeeId(sortedSheetEmployees[0].id);
    }
  }, [selectedSurnameEmployeeId, sortedSheetEmployees]);

  useEffect(() => {
    if (!selectedEmployeeEditorId) {
      return;
    }

    if (!sheetState.employees.some((employee) => employee.id === selectedEmployeeEditorId)) {
      setSelectedEmployeeEditorId(null);
    }
  }, [selectedEmployeeEditorId, sheetState.employees]);

  useEffect(() => {
    let mounted = true;

    async function loadSheet() {
      updateCategorySheetState(setSheetState, category, {
        status: "Loading master sheet..."
      });

      try {
        const data = await api.getMasterSheet({
          date_from: dateRange.date_from,
          date_to: dateRange.date_to,
          category
        });

        if (!mounted) {
          return;
        }

        updateCategorySheetState(setSheetState, category, {
          title: data.title || `${categoryLabel} Master Sheet`,
          employees: data.employees || [],
          dates: data.dates || [],
          records: data.records || [],
          draftsByKey: {},
          status: "Ready",
          loadedRangeKey: currentRangeKey
        });
      } catch (error) {
        if (mounted) {
          updateCategorySheetState(setSheetState, category, {
            status: error.message,
            loadedRangeKey: currentRangeKey
          });
        }
      }
    }

    if (sheetState.loadedRangeKey !== currentRangeKey) {
      loadSheet();
    }

    return () => {
      mounted = false;
    };
  }, [category, categoryLabel, currentRangeKey, dateRange.date_from, dateRange.date_to, setSheetState, sheetState.loadedRangeKey]);

  function updateDraft(employeeId, date, field, value) {
    const key = buildRecordKey(employeeId, date);
    const record = recordsByKey[key];

    draftVersionRef.current.set(key, (draftVersionRef.current.get(key) || 0) + 1);

    updateCategorySheetState(setSheetState, category, (current) => {
      const draftsByKey = current.draftsByKey || {};
      const currentDraft = draftsByKey[key] || createDraft(record, employeeId, date);

      return {
        draftsByKey: {
          ...draftsByKey,
          [key]: {
            ...currentDraft,
            [field]: normalizeInputValue(value)
          }
        }
      };
    });
  }

  async function saveDraft(employeeId, date, options = {}) {
    const { silent = false } = options;
    const key = buildRecordKey(employeeId, date);
    const draft = sheetState.draftsByKey?.[key];
    if (!draft) {
      return;
    }

    const requestVersion = draftVersionRef.current.get(key) || 0;

    const timeIn = (draft.time_in || "").trim();
    const timeOut = (draft.time_out || "").trim();
    const existingRecord = recordsByKey[key];

    if (!existingRecord && !timeIn && !timeOut) {
      updateCategorySheetState(setSheetState, category, (current) => {
        const nextDrafts = { ...(current.draftsByKey || {}) };
        delete nextDrafts[key];

        return {
          draftsByKey: nextDrafts
        };
      });
      draftVersionRef.current.delete(key);
      return;
    }

    if (!silent) {
      updateCategorySheetState(setSheetState, category, {
        status: "Saving master sheet..."
      });
    }

    try {
      const updated = await api.saveMasterSheetRecord({
        employee_id: employeeId,
        date,
        time_in: timeIn || null,
        time_out: timeOut || null,
        schedule_type: draft.schedule_type || existingRecord?.schedule_type || "A"
      });

      const isCurrentDraft = (draftVersionRef.current.get(key) || 0) === requestVersion;

      updateCategorySheetState(setSheetState, category, (current) => {
        const nextRecords = (current.records || []).filter((record) => record.id !== updated.id);

        const nextState = {
          records: [...nextRecords, updated].sort((left, right) => {
            if (left.date !== right.date) {
              return left.date.localeCompare(right.date);
            }

            return String(left.employee_name || "").localeCompare(String(right.employee_name || ""));
          })
        };

        if (!isCurrentDraft) {
          return nextState;
        }

        const nextDrafts = { ...(current.draftsByKey || {}) };
        delete nextDrafts[key];
        draftVersionRef.current.delete(key);

        return {
          ...nextState,
          draftsByKey: nextDrafts,
          status: silent ? current.status : "Attendance record saved"
        };
      });

      api.clearMasterSheetCache({
        date_from: dateRange.date_from,
        date_to: dateRange.date_to,
        category
      });
    } catch (error) {
      updateCategorySheetState(setSheetState, category, {
        status: error.message
      });
    }
  }

  async function exportExcel() {
    try {
      updateCategorySheetState(setSheetState, category, {
        status: "Preparing Excel export..."
      });

      const blob = await api.exportMasterSheet({
        date_from: dateRange.date_from,
        date_to: dateRange.date_to,
        category
      });
      const filename = `${categoryLabel.toLowerCase()}-master-sheet-${month}.xlsx`;
      downloadBlob(blob, filename);
      updateCategorySheetState(setSheetState, category, {
        status: "Excel export ready"
      });
    } catch (error) {
      updateCategorySheetState(setSheetState, category, {
        status: error.message
      });
    }
  }

  function openDateEditor(date) {
    setSelectedEmployeeEditorId(null);
    setSelectedDateEditor(date);
  }

  function closeDateEditor() {
    setSelectedDateEditor(null);
  }

  function openEmployeeEditor(employeeId) {
    setSelectedDateEditor(null);
    setSelectedEmployeeEditorId(employeeId);
  }

  function closeEmployeeEditor() {
    setSelectedEmployeeEditorId(null);
  }

  return (
    <section className="card master-sheet-panel">
      <header className="master-sheet-panel__header">
        <div className="master-sheet-panel__meta">
          <p className="section-kicker">{categoryLabel}</p>
          <h3>{sheetState.title || `${categoryLabel} Master Sheet`}</h3>
          <p className="subtle">Month: {monthLabel}</p>
          <p className="subtle">
            Range: {formatDisplayDate(dateRange.date_from)} to {formatDisplayDate(dateRange.date_to)}
          </p>
          <p className="subtle">Status: {sheetState.status}</p>
          <p className="subtle">Click a date to edit that day's attendance rows, or click a surname to edit that employee's monthly times.</p>
        </div>
        <button type="button" onClick={exportExcel}>Export Excel</button>
      </header>

      {sheetView === "master" ? (
        <div className="master-sheet-scroll table-container">
          <table className="master-sheet-table" style={{ minWidth: `${tableMinWidth}px` }}>
            <colgroup>
              <col className="master-sheet-date-col" />
              <col className="master-sheet-day-col" />
              {sheetState.employees.map((employee) => (
                <Fragment key={`${employee.id}-cols`}>
                  <col className="master-sheet-time-col" />
                  <col className="master-sheet-time-col" />
                </Fragment>
              ))}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan="2" className="master-sheet-date-col">DATE</th>
                <th rowSpan="2" className="master-sheet-day-col">DAY</th>
                {sheetState.employees.map((employee) => (
                  <th key={employee.id} colSpan="2" className="master-sheet-employee-col">
                    <button
                      type="button"
                      className="master-sheet-employee-button"
                      onClick={() => openEmployeeEditor(employee.id)}
                      aria-label={`Edit monthly times for ${(employee.surname || employee.name || "").trim() || "employee"}`}
                      title="Click to edit monthly time entries"
                    >
                      {(employee.surname || employee.name || "").toUpperCase()}
                    </button>
                  </th>
                ))}
              </tr>
              <tr>
                {sheetState.employees.map((employee) => (
                  <Fragment key={`${employee.id}-subheaders`}>
                    <th className="master-sheet-subheader">TIME IN</th>
                    <th className="master-sheet-subheader master-sheet-time-out-header">TIME OUT</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheetState.dates.map((dateInfo, index) => (
                <tr key={dateInfo.date} className={dateInfo.is_weekend ? "sheet-weekend-row" : ""} style={{ "--row-index": index }}>
                  <td className={`master-sheet-date-col ${dateInfo.is_monday ? "is-monday" : dateInfo.is_weekend ? "is-weekend" : ""}`}>
                    <button
                      type="button"
                      className="master-sheet-date-button"
                      onClick={() => openDateEditor(dateInfo.date)}
                      aria-label={`Edit attendance and day rule for ${formatDisplayDate(dateInfo.date)}`}
                      title="Click to edit attendance and day rule"
                    >
                      {dateInfo.label}
                    </button>
                  </td>
                  <td className={`master-sheet-day-col ${dateInfo.is_monday ? "is-monday" : dateInfo.is_weekend ? "is-weekend" : ""}`}>
                    {dateInfo.weekday}
                  </td>
                  {sheetState.employees.map((employee) => {
                    const key = buildRecordKey(employee.id, dateInfo.date);
                    const draft = sheetState.draftsByKey?.[key] || createDraft(recordsByKey[key], employee.id, dateInfo.date);

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
                            onBlur={() => saveDraft(employee.id, dateInfo.date)}
                          />
                        </td>
                        <td className="master-sheet-time-out-cell">
                          <input
                            className="master-sheet-input"
                            type="text"
                            value={draft.time_out}
                            spellCheck={false}
                            autoComplete="off"
                            onChange={(event) => updateDraft(employee.id, dateInfo.date, "time_out", event.target.value)}
                            onBlur={() => saveDraft(employee.id, dateInfo.date)}
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
      ) : (
        <section className="master-sheet-surname-view">
          {isLoadingSheet && !sheetState.employees.length ? (
            <p className="subtle master-sheet-preview-empty">Loading surname tab...</p>
          ) : selectedSurnameEmployee ? (
            <EmployeeSurnameSheet
              key={selectedSurnameEmployee.id}
              employee={selectedSurnameEmployee}
              periodLabel={periodLabel}
              rows={previewRowsByEmployee[selectedSurnameEmployee.id] || []}
            />
          ) : (
            <p className="subtle master-sheet-preview-empty">No employees are available for this category yet.</p>
          )}

          <div className="master-sheet-surname-tabs" role="tablist" aria-label="Surname tabs">
            {sortedSheetEmployees.map((employee) => (
              <button
                key={employee.id}
                type="button"
                role="tab"
                aria-selected={selectedSurnameEmployee?.id === employee.id}
                className={selectedSurnameEmployee?.id === employee.id ? "mini-tab active" : "mini-tab"}
                onClick={() => setSelectedSurnameEmployeeId(employee.id)}
              >
                {getEmployeeSheetTabLabel(employee).toUpperCase()}
              </button>
            ))}
          </div>
        </section>
      )}

      {selectedDateEditor ? (
        <MasterSheetDateEditorModal
          key={`${category}:${selectedDateEditor}`}
          date={selectedDateEditor}
          category={category}
          categoryLabel={categoryLabel}
          employees={sheetState.employees || []}
          recordsByKey={recordsByKey}
          draftsByKey={sheetState.draftsByKey || {}}
          updateDraft={updateDraft}
          saveDraft={saveDraft}
          onClose={closeDateEditor}
        />
      ) : null}

      {selectedEmployeeEditor ? (
        <MasterSheetEmployeeEditorModal
          key={`${category}:${month}:${selectedEmployeeEditor.id}`}
          employee={selectedEmployeeEditor}
          categoryLabel={categoryLabel}
          periodLabel={periodLabel}
          dates={sheetState.dates || []}
          recordsByKey={recordsByKey}
          draftsByKey={sheetState.draftsByKey || {}}
          updateDraft={updateDraft}
          saveDraft={saveDraft}
          onClose={closeEmployeeEditor}
        />
      ) : null}

      <div className="master-sheet-view-switcher">
        <p className="subtle">Sheet controls</p>
        <div className="tab-cluster master-sheet-view-tabs" aria-label="Master sheet views">
          <button
            type="button"
            aria-pressed={!isEmployeeSheetOpen}
            className={!isEmployeeSheetOpen ? "mini-tab active" : "mini-tab"}
            onClick={() => {
              setSheetView("master");
              setIsEmployeeSheetOpen(false);
            }}
          >
            Master Sheet
          </button>
          <button
            type="button"
            aria-pressed={isEmployeeSheetOpen}
            className={isEmployeeSheetOpen ? "mini-tab active" : "mini-tab"}
            onClick={() => {
              setSheetView("master");
              setIsEmployeeSheetOpen(true);
            }}
          >
            Employee Sheet
          </button>
        </div>
      </div>

      {isEmployeeSheetOpen ? (
        <MasterSheetEmployeeSheetModal
          key={`${category}:${month}:employee-sheet`}
          category={category}
          categoryLabel={categoryLabel}
          periodLabel={periodLabel}
          employees={sheetState.employees || []}
          selectedEmployeeId={selectedSurnameEmployeeId}
          setSelectedEmployeeId={setSelectedSurnameEmployeeId}
          rowsByEmployee={previewRowsByEmployee}
          onClose={() => setIsEmployeeSheetOpen(false)}
        />
      ) : null}
    </section>
  );
}

export default function MasterSheetPage() {
  const [month, setMonth] = useState(() => getManilaMonth());
  const [activeCategory, setActiveCategory] = useState(() => {
    if (typeof window === "undefined") {
      return "regular";
    }

    const storedCategory = window.localStorage.getItem("admin-master-sheet-category");
    return storedCategory === "jo" ? "jo" : "regular";
  });
  const [sheetStateByCategory, setSheetStateByCategory] = useState(() => ({
    regular: createEmptySheetState(),
    jo: createEmptySheetState()
  }));
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const monthLabel = useMemo(() => formatMonthLabel(month), [month]);
  const dateRange = useMemo(() => getMonthRange(month), [month]);
  const activeSheetState = sheetStateByCategory[activeCategory] || createEmptySheetState();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem("admin-master-sheet-category", activeCategory);
  }, [activeCategory]);
  
  useEffect(() => {
    function handleMasterSheetInvalidate() {
      setSheetStateByCategory((prev) => ({
        regular: {
          ...prev.regular,
          loadedRangeKey: ""
        },
        jo: {
          ...prev.jo,
          loadedRangeKey: ""
        }
      }));
    }
  
    window.addEventListener("master-sheet:invalidate", handleMasterSheetInvalidate);
    return () => window.removeEventListener("master-sheet:invalidate", handleMasterSheetInvalidate);
  }, []);

  return (
    <section className="card master-sheet-page">
      <header className="master-sheet-page__header">
        <div>
          <p className="section-kicker">Master Record Sheet</p>
          <h2>{monthLabel}</h2>
          <p className="subtle">Use the tabs to switch between Regular and Job Order. Month results stay cached while you browse.</p>
        </div>
        <div className="master-sheet-page__controls">
          <label className="master-sheet-month-field">
            <span>Month</span>
            <select value={month} onChange={(event) => setMonth(event.target.value)}>
              {monthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="status-pill status-pill--live">Viewing: {monthLabel}</div>
        </div>
      </header>

      <div className="master-sheet-toolbar">
        <div className="tab-cluster" role="tablist" aria-label="Master sheet categories">
          <button
            type="button"
            role="tab"
            aria-selected={activeCategory === "regular"}
            className={activeCategory === "regular" ? "mini-tab active" : "mini-tab"}
            onClick={() => setActiveCategory("regular")}
          >
            Regular
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeCategory === "jo"}
            className={activeCategory === "jo" ? "mini-tab active" : "mini-tab"}
            onClick={() => setActiveCategory("jo")}
          >
            Job Order
          </button>
        </div>
        <p className="subtle master-sheet-note">Cached month data loads instantly when you return to a tab.</p>
      </div>

      <MasterSheetCategoryPanel
        key={activeCategory}
        category={activeCategory}
        month={month}
        monthLabel={monthLabel}
        dateRange={dateRange}
        sheetState={activeSheetState}
        setSheetState={setSheetStateByCategory}
      />
    </section>
  );
}