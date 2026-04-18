import { Fragment, useEffect, useMemo, useState } from "react";
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

function buildMonthOptions(referenceDate = new Date(), totalMonths = 36) {
  const values = getManilaDateParts(referenceDate);
  const startDate = new Date(Date.UTC(Number(values.year), Number(values.month) - totalMonths, 1, 12, 0, 0));

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

function getEmployeeOffice(employee) {
  return (employee.office || "").trim().toUpperCase();
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
      is_weekend: Boolean(dateInfo.is_weekend),
      is_monday: Boolean(dateInfo.is_monday)
    };
  });
}

function getCategoryLabel(category) {
  return category === "regular" ? "Regular" : "JO";
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

function EmployeeSurnameSheet({ employee, periodLabel, rows }) {
  const employeeNo = formatPlaceholder(String(employee.employee_no || employee.id || "").trim());
  const lastName = formatPlaceholder((employee.surname || employee.last_name || employee.name || employee.display_name || "").trim().toUpperCase());
  const displayName = formatPlaceholder((employee.display_name || employee.name || "").trim().toUpperCase());
  const firstName = composeEmployeeFirstName(employee, "N/A").toUpperCase();
  const office = formatPlaceholder(getEmployeeOffice(employee));

  return (
    <article className="master-sheet-surname-sheet">
      <header className="master-sheet-surname-sheet__header">
        <p className="section-kicker">Surname tab</p>
        <h4>{lastName}</h4>
        <p className="subtle">No. {employeeNo || "-"} · {displayName}</p>
      </header>

      <div className="master-sheet-surname-sheet__page">
        <div className="master-sheet-surname-sheet__page-header">
          <p className="master-sheet-surname-sheet__institution">TECHNICAL EDUCATION AND SKILLS DEVELOPMENT AUTHORITY (TESDA)</p>
          <p className="master-sheet-surname-sheet__subinstitution">National Capital Region - MuniPalasTaPat</p>
          <h5>DAILY TIME RECORD</h5>
          <p className="master-sheet-surname-sheet__period">{periodLabel}</p>
        </div>

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
            <span>Office</span>
            <strong>{office}</strong>
          </div>
        </div>

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
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date}>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="master-sheet-surname-sheet__footer">
          <p className="master-sheet-surname-sheet__statement">
            I CERTIFY on my honor that the above is a true and correct report of the hours of work performed, record of which was made daily at the time of arrival at and departure from office.
          </p>
          <div className="master-sheet-surname-sheet__signatures">
            <div>
              <strong>{firstName}</strong>
              <span>Name/Signature</span>
            </div>
            <div>
              <strong>{formatPlaceholder("GERARDO A. MERCADO")}</strong>
              <span>Head of Office</span>
              <span>Name/Signature</span>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function MasterSheetCategoryPanel({ category, month, monthLabel, dateRange, sheetState, setSheetState }) {
  const categoryLabel = getCategoryLabel(category);
  const currentRangeKey = `${dateRange.date_from}:${dateRange.date_to}`;
  const tableMinWidth = Math.max(900, 192 + (sheetState.employees.length * 184));
  const periodLabel = formatPeriodLabel(dateRange.date_from, dateRange.date_to);
  const isLoadingSheet = sheetState.status.startsWith("Loading");
  const [sheetView, setSheetView] = useState("master");
  const [selectedSurnameEmployeeId, setSelectedSurnameEmployeeId] = useState(null);

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

  const selectedSurnameEmployee = useMemo(() => {
    if (!sheetState.employees.length) {
      return null;
    }

    return sheetState.employees.find((employee) => employee.id === selectedSurnameEmployeeId) || sheetState.employees[0];
  }, [selectedSurnameEmployeeId, sheetState.employees]);

  useEffect(() => {
    if (!sheetState.employees.length) {
      setSelectedSurnameEmployeeId(null);
      return;
    }

    if (!sheetState.employees.some((employee) => employee.id === selectedSurnameEmployeeId)) {
      setSelectedSurnameEmployeeId(sheetState.employees[0].id);
    }
  }, [selectedSurnameEmployeeId, sheetState.employees]);

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

  async function saveDraft(employeeId, date) {
    const key = buildRecordKey(employeeId, date);
    const draft = sheetState.draftsByKey?.[key];
    if (!draft) {
      return;
    }

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
      return;
    }

    updateCategorySheetState(setSheetState, category, {
      status: "Saving master sheet..."
    });

    try {
      const updated = await api.saveMasterSheetRecord({
        employee_id: employeeId,
        date,
        time_in: timeIn || null,
        time_out: timeOut || null,
        schedule_type: draft.schedule_type || existingRecord?.schedule_type || "A"
      });

      updateCategorySheetState(setSheetState, category, (current) => {
        const nextRecords = (current.records || []).filter((record) => record.id !== updated.id);

        return {
          records: [...nextRecords, updated].sort((left, right) => {
            if (left.date !== right.date) {
              return left.date.localeCompare(right.date);
            }

            return String(left.employee_name || "").localeCompare(String(right.employee_name || ""));
          })
        };
      });

      api.clearMasterSheetCache({
        date_from: dateRange.date_from,
        date_to: dateRange.date_to,
        category
      });

      updateCategorySheetState(setSheetState, category, (current) => {
        const nextDrafts = { ...(current.draftsByKey || {}) };
        delete nextDrafts[key];

        return {
          draftsByKey: nextDrafts,
          status: "Attendance record saved"
        };
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
                    {(employee.surname || employee.name || "").toUpperCase()}
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
              {sheetState.dates.map((dateInfo) => (
                <tr key={dateInfo.date} className={dateInfo.is_weekend ? "sheet-weekend-row" : ""}>
                  <td className={`master-sheet-date-col ${dateInfo.is_monday ? "is-monday" : dateInfo.is_weekend ? "is-weekend" : ""}`}>
                    {dateInfo.label}
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
              employee={selectedSurnameEmployee}
              periodLabel={periodLabel}
              rows={previewRowsByEmployee[selectedSurnameEmployee.id] || []}
            />
          ) : (
            <p className="subtle master-sheet-preview-empty">No employees are available for this category yet.</p>
          )}

          <div className="master-sheet-surname-tabs" role="tablist" aria-label="Surname tabs">
            {sheetState.employees.map((employee) => (
              <button
                key={employee.id}
                type="button"
                role="tab"
                aria-selected={selectedSurnameEmployee?.id === employee.id}
                className={selectedSurnameEmployee?.id === employee.id ? "mini-tab active" : "mini-tab"}
                onClick={() => setSelectedSurnameEmployeeId(employee.id)}
              >
                {(employee.surname || employee.name || "").toUpperCase()}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="master-sheet-view-switcher">
        <p className="subtle">Sheet tabs</p>
        <div className="tab-cluster master-sheet-view-tabs" role="tablist" aria-label="Master sheet views">
          <button
            type="button"
            role="tab"
            aria-selected={sheetView === "master"}
            className={sheetView === "master" ? "mini-tab active" : "mini-tab"}
            onClick={() => setSheetView("master")}
          >
            Master Sheet
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sheetView === "surnames"}
            className={sheetView === "surnames" ? "mini-tab active" : "mini-tab"}
            onClick={() => setSheetView("surnames")}
          >
            Surnames
          </button>
        </div>
      </div>
    </section>
  );
}

export default function MasterSheetPage() {
  const [month, setMonth] = useState(() => getManilaMonth());
  const [activeCategory, setActiveCategory] = useState("regular");
  const [sheetStateByCategory, setSheetStateByCategory] = useState(() => ({
    regular: createEmptySheetState(),
    jo: createEmptySheetState()
  }));
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const monthLabel = useMemo(() => formatMonthLabel(month), [month]);
  const dateRange = useMemo(() => getMonthRange(month), [month]);
  const activeSheetState = sheetStateByCategory[activeCategory] || createEmptySheetState();
  
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
          <p className="subtle">Use the tabs to switch between Regular and JO. Month results stay cached while you browse.</p>
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
            JO
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