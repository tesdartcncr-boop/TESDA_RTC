import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../services/api";

const WEEKDAYS = [
  { day_of_week: 0, day_name: "Monday" },
  { day_of_week: 1, day_name: "Tuesday" },
  { day_of_week: 2, day_name: "Wednesday" },
  { day_of_week: 3, day_name: "Thursday" },
  { day_of_week: 4, day_name: "Friday" },
  { day_of_week: 5, day_name: "Saturday" },
  { day_of_week: 6, day_name: "Sunday" }
];

const CATEGORY_OPTIONS = [
  { value: "regular", label: "Regular", description: "Permanent staff schedule" },
  { value: "jo", label: "Job Order", description: "JO schedule" }
];

const CATEGORY_LABELS = {
  regular: "Regular",
  jo: "Job Order"
};

const REGULAR_PRESETS = [
  {
    value: 480,
    label: "8-hour schedule",
    requiredHoursLabel: "8 hours",
    scheduleEnd: "17:00",
    weekdayLateThreshold: "10:01",
    mondayLateThreshold: "08:01",
    description: "7:00 AM floor, Monday late at 8:01 AM, other days late at 10:01 AM."
  },
  {
    value: 600,
    label: "10-hour schedule",
    requiredHoursLabel: "10 hours",
    scheduleEnd: "19:00",
    weekdayLateThreshold: "09:01",
    mondayLateThreshold: "08:01",
    description: "7:00 AM floor, Monday late at 8:01 AM, other days late at 9:01 AM."
  }
];

const DEFAULT_REGULAR_PRESET = REGULAR_PRESETS[0].value;
const CALENDAR_LOADING_POPUP_DELAY_MS = 300;
const CALENDAR_OVERRIDE_CACHE_TTL_MS = 60 * 1000;
const MANILA_TIME_ZONE = "Asia/Manila";
const CALENDAR_WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getManilaDate(referenceDate = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(referenceDate);

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getManilaMonth(referenceDate = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(referenceDate);

  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}`;
}

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const referenceDate = new Date(Date.UTC(year, month - 1, 1, 12));

  return new Intl.DateTimeFormat("en-US", {
    timeZone: MANILA_TIME_ZONE,
    month: "long",
    year: "numeric"
  }).format(referenceDate);
}

function shiftMonth(monthKey, offset) {
  const [year, month] = monthKey.split("-").map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
  return `${String(nextDate.getUTCFullYear()).padStart(4, "0")}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getMonthBounds(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const lastDayKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  return {
    dateFrom: firstDay,
    dateTo: lastDayKey
  };
}

function buildCalendarCells(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDate = new Date(Date.UTC(year, month - 1, 1, 12));
  const daysInMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const leadingBlanks = (firstDate.getUTCDay() + 6) % 7;
  const cells = [];

  for (let index = 0; index < leadingBlanks; index += 1) {
    cells.push({ key: `blank-${index}`, blank: true });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateValue = new Date(Date.UTC(year, month - 1, day, 12));
    const dateKey = getManilaDate(dateValue);
    cells.push({
      key: dateKey,
      blank: false,
      dateKey,
      day,
      weekdayIndex: (dateValue.getUTCDay() + 6) % 7,
      isToday: dateKey === getManilaDate()
    });
  }

  return cells;
}

function chunkCalendarCells(cells) {
  const weeks = [];

  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  return weeks;
}

function formatHours(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  return "08:00";
}

function minutesToTime(totalMinutes) {
  const numericMinutes = Number(totalMinutes) || 0;
  const hours = Math.floor(numericMinutes / 60);
  const minutes = numericMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function createDefaultRow(day) {
  return {
    day_of_week: day.day_of_week,
    day_name: day.day_name,
    schedule_start: "08:00",
    schedule_end: "17:00",
    late_threshold: "08:00",
    required_hours: "08:00"
  };
}

function createDefaultDrafts() {
  return {
    regular: WEEKDAYS.map(createDefaultRow),
    jo: WEEKDAYS.map(createDefaultRow)
  };
}

function getRegularPreset(requiredMinutes) {
  return REGULAR_PRESETS.find((preset) => preset.value === Number(requiredMinutes)) || REGULAR_PRESETS[0];
}

function buildRegularRows(requiredMinutes) {
  const preset = getRegularPreset(requiredMinutes);

  return WEEKDAYS.map((day) => ({
    day_of_week: day.day_of_week,
    day_name: day.day_name,
    schedule_start: "08:00",
    schedule_end: preset.scheduleEnd,
    late_threshold: day.day_of_week === 0 ? preset.mondayLateThreshold : preset.weekdayLateThreshold,
    required_hours: String(preset.value / 60),
    required_minutes: preset.value
  }));
}

function inferRegularPreset(rows) {
  const firstRequiredMinutes = Number(rows?.[0]?.required_minutes);
  return getRegularPreset(Number.isFinite(firstRequiredMinutes) ? firstRequiredMinutes : DEFAULT_REGULAR_PRESET).value;
}

function normalizeRows(rows) {
  const rowsByDay = new Map();
  for (const row of rows || []) {
    const dayOfWeek = Number(row?.day_of_week);
    if (!Number.isInteger(dayOfWeek)) {
      continue;
    }

    rowsByDay.set(dayOfWeek, row);
  }

  return WEEKDAYS.map((day) => {
    const existing = rowsByDay.get(day.day_of_week);
    if (!existing) {
      return createDefaultRow(day);
    }

    return {
      day_of_week: day.day_of_week,
      day_name: day.day_name,
      schedule_start: existing.schedule_start || "08:00",
      schedule_end: existing.schedule_end || "17:00",
      late_threshold: existing.late_threshold || "08:00",
      required_hours: typeof existing.required_hours === "string" && existing.required_hours.trim() ? existing.required_hours.trim() : (existing.required_minutes != null ? minutesToTime(existing.required_minutes) : "08:00")
    };
  });
}

function buildOverridesMap(rows) {
  const nextOverrides = {};

  for (const row of rows || []) {
    if (row?.date) {
      nextOverrides[row.date] = row;
    }
  }

  return nextOverrides;
}

function countRedOverrides(overrides) {
  return Object.values(overrides || []).filter((row) => String(row?.schedule_type || "").trim().toUpperCase() === "B").length;
}

export default function WeeklySchedulePanel({
  title = "Weekly schedule",
  description = "Set the late time, schedule window, and required work hours for each day of the week.",
  saveLabel = "Save Weekly Schedule",
  className = "",
  onSaved = null
}) {
  const [selectedCategory, setSelectedCategory] = useState("regular");
  const [drafts, setDrafts] = useState(() => createDefaultDrafts());
  const [loadedCategories, setLoadedCategories] = useState({ regular: false, jo: false });
  const [regularPreset, setRegularPreset] = useState(DEFAULT_REGULAR_PRESET);
  const [status, setStatus] = useState("Loading Regular schedule...");
  const [calendarMonth, setCalendarMonth] = useState(() => getManilaMonth());
  const [calendarOverrides, setCalendarOverrides] = useState({});
  const [calendarStatus, setCalendarStatus] = useState("Loading calendar...");
  const [isCalendarSaving, setIsCalendarSaving] = useState(false);
  const [calendarBusyVisible, setCalendarBusyVisible] = useState(false);
  const [calendarBusyMessage, setCalendarBusyMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const requestIdRef = useRef(0);
  const calendarLoadRequestRef = useRef(0);
  const calendarBusyTimerRef = useRef(null);
  const calendarOverridesCacheRef = useRef(new Map());

  const activeCategory = CATEGORY_OPTIONS.find((option) => option.value === selectedCategory) || CATEGORY_OPTIONS[0];
  const activeRows = selectedCategory === "regular" ? buildRegularRows(regularPreset) : drafts[selectedCategory] || WEEKDAYS.map(createDefaultRow);
  const activeRegularPreset = getRegularPreset(regularPreset);
  const calendarCells = useMemo(() => buildCalendarCells(calendarMonth), [calendarMonth]);
  const calendarWeeks = useMemo(() => chunkCalendarCells(calendarCells), [calendarCells]);
  const calendarMonthLabel = useMemo(() => formatMonthLabel(calendarMonth), [calendarMonth]);

  function clearCalendarBusyTimer() {
    if (calendarBusyTimerRef.current !== null) {
      window.clearTimeout(calendarBusyTimerRef.current);
      calendarBusyTimerRef.current = null;
    }
  }

  function beginCalendarBusy(message) {
    clearCalendarBusyTimer();
    setCalendarBusyMessage(message);
    setCalendarBusyVisible(false);
    calendarBusyTimerRef.current = window.setTimeout(() => {
      setCalendarBusyVisible(true);
    }, CALENDAR_LOADING_POPUP_DELAY_MS);
  }

  function endCalendarBusy() {
    clearCalendarBusyTimer();
    setCalendarBusyVisible(false);
    setCalendarBusyMessage("");
  }

  function updateCalendarCache(monthKey, overrides) {
    calendarOverridesCacheRef.current.set(monthKey, {
      savedAt: Date.now(),
      data: overrides
    });
  }

  useEffect(() => {
    return () => {
      if (calendarBusyTimerRef.current !== null) {
        window.clearTimeout(calendarBusyTimerRef.current);
      }
    };
  }, []);

  async function loadCalendarOverrides({ monthKey = calendarMonth, forceRefresh = false } = {}) {
    if (selectedCategory !== "regular") {
      return {};
    }

    const cacheEntry = calendarOverridesCacheRef.current.get(monthKey);
    if (!forceRefresh && cacheEntry && Date.now() - cacheEntry.savedAt < CALENDAR_OVERRIDE_CACHE_TTL_MS) {
      setCalendarOverrides(cacheEntry.data);
      const cachedCount = countRedOverrides(cacheEntry.data);
      setCalendarStatus(cachedCount ? `${cachedCount} red date${cachedCount === 1 ? "" : "s"} loaded` : "No red dates yet");
      return cacheEntry.data;
    }

    const requestId = ++calendarLoadRequestRef.current;
    const loadingMessage = `Loading ${formatMonthLabel(monthKey)} calendar...`;
    const { dateFrom, dateTo } = getMonthBounds(monthKey);

    setIsCalendarSaving(true);
    setCalendarStatus(loadingMessage);
    beginCalendarBusy(loadingMessage);

    try {
      const data = await api.getScheduleOverrides(dateFrom, dateTo);
      if (requestId !== calendarLoadRequestRef.current) {
        return {};
      }

      const nextOverrides = buildOverridesMap(data);
      updateCalendarCache(monthKey, nextOverrides);
      setCalendarOverrides(nextOverrides);
      const exceptionCount = countRedOverrides(nextOverrides);
      setCalendarStatus(exceptionCount ? `${exceptionCount} red date${exceptionCount === 1 ? "" : "s"} loaded` : "No red dates yet");
      return nextOverrides;
    } catch (error) {
      if (requestId !== calendarLoadRequestRef.current) {
        return {};
      }

      setCalendarStatus(error.message);
      throw error;
    } finally {
      if (requestId === calendarLoadRequestRef.current) {
        setIsCalendarSaving(false);
        endCalendarBusy();
      }
    }
  }

  useEffect(() => {
    if (selectedCategory !== "regular") {
      return undefined;
    }

    loadCalendarOverrides({ monthKey: calendarMonth }).catch(() => {});

    function handleScheduleInvalidate(event) {
      const payloadDate = event?.detail?.payload?.date || event?.detail?.date || "";
      if (payloadDate && !payloadDate.startsWith(calendarMonth)) {
        return;
      }

      calendarOverridesCacheRef.current.delete(calendarMonth);
      loadCalendarOverrides({ monthKey: calendarMonth, forceRefresh: true }).catch(() => {});
    }

    window.addEventListener("schedule-settings:invalidate", handleScheduleInvalidate);

    return () => {
      calendarLoadRequestRef.current += 1;
      window.removeEventListener("schedule-settings:invalidate", handleScheduleInvalidate);
      setIsCalendarSaving(false);
      endCalendarBusy();
    };
  }, [selectedCategory, calendarMonth]);

  useEffect(() => {
    let mounted = true;

    async function loadWeeklySchedule() {
      if (loadedCategories[selectedCategory]) {
        setStatus(`${CATEGORY_LABELS[selectedCategory] || "Weekly"} schedule ready`);
        return;
      }

      const requestId = ++requestIdRef.current;
      setStatus(`Loading ${CATEGORY_LABELS[selectedCategory] || "Weekly"} schedule...`);

      try {
        const data = await api.getWeeklySchedules(selectedCategory);
        if (!mounted || requestId !== requestIdRef.current) {
          return;
        }

        if (selectedCategory === "regular") {
          const nextPreset = inferRegularPreset(data);
          setRegularPreset(nextPreset);
          setDrafts((current) => ({
            ...current,
            regular: buildRegularRows(nextPreset)
          }));
        } else {
          const normalizedRows = normalizeRows(data);
          setDrafts((current) => ({
            ...current,
            jo: normalizedRows
          }));
        }
        setLoadedCategories((current) => ({
          ...current,
          [selectedCategory]: true
        }));
        setStatus(`${CATEGORY_LABELS[selectedCategory] || "Weekly"} schedule loaded`);
      } catch (error) {
        if (!mounted || requestId !== requestIdRef.current) {
          return;
        }

        setStatus(error.message);
      }
    }

    loadWeeklySchedule();

    return () => {
      mounted = false;
      requestIdRef.current += 1;
    };
  }, [selectedCategory, loadedCategories]);

  function handleCategoryChange(nextCategory) {
    if (nextCategory === selectedCategory) {
      return;
    }

    setSelectedCategory(nextCategory);
    setStatus(`Loading ${CATEGORY_LABELS[nextCategory] || "Weekly"} schedule...`);
  }

  function handleRegularPresetChange(nextPreset) {
    const preset = getRegularPreset(nextPreset);
    if (preset.value === regularPreset) {
      return;
    }

    const nextRows = buildRegularRows(preset.value);
    setRegularPreset(preset.value);
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      regular: nextRows
    }));

    if (loadedCategories.regular) {
      void persistWeeklySchedule("regular", nextRows).catch(() => {});
    }
  }

  function handleCalendarMonthChange(offset) {
    setCalendarMonth((currentMonth) => shiftMonth(currentMonth, offset));
  }

  async function handleCalendarDateToggle(dateKey) {
    if (isCalendarSaving) {
      return;
    }

    setIsCalendarSaving(true);
    beginCalendarBusy(`Updating ${dateKey} schedule...`);
    setCalendarStatus(`Updating ${dateKey}...`);
    const monthKey = calendarMonth;

    try {
      const data = await api.toggleScheduleOverride({ date: dateKey });
      setCalendarOverrides((currentOverrides) => {
        const nextOverrides = { ...currentOverrides };
        if (data.enabled) {
          nextOverrides[dateKey] = {
            date: dateKey,
            schedule_type: data.schedule_type || "B",
            late_threshold: data.late_threshold || "08:00"
          };
        } else {
          delete nextOverrides[dateKey];
        }

        updateCalendarCache(monthKey, nextOverrides);
        return nextOverrides;
      });

      setCalendarStatus(data.enabled ? `${dateKey} marked red for 10 hours` : `${dateKey} returned to green`);
    } catch (error) {
      setCalendarStatus(error.message);
    } finally {
      setIsCalendarSaving(false);
      endCalendarBusy();
    }
  }

  function updateRow(dayOfWeek, field, value) {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [selectedCategory]: (currentDrafts[selectedCategory] || []).map((row) =>
        row.day_of_week === dayOfWeek
          ? {
              ...row,
              [field]: value
            }
          : row
      )
    }));
  }

  async function persistWeeklySchedule(category, rowsToSave) {
    setIsSaving(true);
    setStatus(`Saving ${CATEGORY_LABELS[category] || "Weekly"} schedule...`);

    try {
      const payload = {
        category,
        schedules: rowsToSave.map((row) => ({
          day_of_week: row.day_of_week,
          schedule_start: row.schedule_start,
          schedule_end: row.schedule_end,
          late_threshold: row.late_threshold,
          required_hours: formatHours(row.required_hours)
        }))
      };

      const data = await api.setWeeklySchedules(payload);
      const savedRows = Array.isArray(data?.schedules) ? data.schedules : rowsToSave;
      if (category === "regular") {
        const nextPreset = inferRegularPreset(savedRows);
        setRegularPreset(nextPreset);
        setDrafts((currentDrafts) => ({
          ...currentDrafts,
          regular: buildRegularRows(nextPreset)
        }));
      } else {
        const normalizedRows = normalizeRows(savedRows);
        setDrafts((currentDrafts) => ({
          ...currentDrafts,
          jo: normalizedRows
        }));
      }
      setLoadedCategories((currentLoaded) => ({
        ...currentLoaded,
        [category]: true
      }));
      setStatus(`Saved ${CATEGORY_LABELS[category] || "weekly"} schedule and recalculated ${data?.updated_count || 0} attendance rows.`);

      if (typeof onSaved === "function") {
        await onSaved(data);
      }

      return data;
    } catch (error) {
      setStatus(error.message);
      throw error;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSave() {
    await persistWeeklySchedule(selectedCategory, activeRows);
  }

  const calendarBusyOverlay = calendarBusyVisible && typeof document !== "undefined"
    ? createPortal(
        <div className="weekly-schedule-calendar__loading-modal" role="status" aria-live="polite" aria-busy="true">
          <section className="weekly-schedule-calendar__loading-card">
            <div className="weekly-schedule-calendar__spinner" aria-hidden="true" />
            <strong>{calendarBusyMessage}</strong>
            <p>Please wait while the schedule and attendance rows are being updated.</p>
          </section>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <section className={`card weekly-schedule-card ${className}`.trim()}>
      <header className="weekly-schedule-card__header">
        <div className="weekly-schedule-card__intro">
          <p className="section-kicker">Week rules</p>
          <h3>{title}</h3>
          <p className="subtle">{description}</p>
        </div>
        <div className="weekly-schedule-card__header-meta">
          <div className="status-pill status-pill--live">{selectedCategory === "regular" ? `${activeRegularPreset.requiredHoursLabel} preset` : `${activeCategory.label} schedule`}</div>
          <p className="subtle">Status: {selectedCategory === "regular" ? calendarStatus : status}</p>
          {selectedCategory === "regular" ? <p className="subtle">Weekly base: {status}</p> : null}
        </div>
      </header>

      <div className="weekly-schedule-switcher" role="tablist" aria-label="Weekly schedule category">
        {CATEGORY_OPTIONS.map((option) => (
          <button
            type="button"
            key={option.value}
            role="tab"
            aria-selected={selectedCategory === option.value}
            className={selectedCategory === option.value ? "weekly-schedule-switcher__button is-active" : "weekly-schedule-switcher__button"}
            onClick={() => handleCategoryChange(option.value)}
            disabled={isSaving}
          >
            <strong>{option.label}</strong>
            <span>{option.description}</span>
          </button>
        ))}
      </div>

      {selectedCategory === "regular" ? (
        <>
          <div className="weekly-schedule-preset-grid" role="tablist" aria-label="Regular schedule presets">
            {REGULAR_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.value}
                role="tab"
                aria-selected={regularPreset === preset.value}
                className={regularPreset === preset.value ? "weekly-schedule-preset-card is-active" : "weekly-schedule-preset-card"}
                onClick={() => handleRegularPresetChange(preset.value)}
                disabled={isSaving}
              >
                <strong>{preset.label}</strong>
                <span>{preset.description}</span>
              </button>
            ))}
          </div>

          <div className="weekly-schedule-summary-grid">
            <article className="weekly-schedule-summary-card">
              <span>Required hours</span>
              <strong>{activeRegularPreset.requiredHoursLabel}</strong>
              <p>Computed as the default basis for regular attendance.</p>
            </article>
            <article className="weekly-schedule-summary-card">
              <span>Earliest record</span>
              <strong>7:00 AM</strong>
              <p>Earlier punches are recorded at 7:00 AM for regular employees.</p>
            </article>
            <article className="weekly-schedule-summary-card">
              <span>Monday late</span>
              <strong>8:01 AM</strong>
              <p>Monday uses the same late threshold for both regular presets.</p>
            </article>
            <article className="weekly-schedule-summary-card">
              <span>Other days late</span>
              <strong>{activeRegularPreset.weekdayLateThreshold} AM</strong>
              <p>Tuesday to Sunday follow the selected preset threshold.</p>
            </article>
            <article className="weekly-schedule-summary-card">
              <span>Lunch break</span>
              <strong>12:00 PM - 1:00 PM</strong>
              <p>Lunch is excluded from credited hours and undertime calculations.</p>
            </article>
          </div>

          <div className="weekly-schedule-grid weekly-schedule-grid--readonly weekly-schedule-grid--compact">
            {activeRows.map((row) => (
              <article key={`${selectedCategory}-${row.day_of_week}`} className="weekly-schedule-day-card weekly-schedule-day-card--readonly">
                <div className="weekly-schedule-day-card__heading">
                  <p className="section-kicker">Day {row.day_of_week + 1}</p>
                  <h4>{row.day_name}</h4>
                </div>

                <div className="weekly-schedule-day-card__details">
                  <div>
                    <span>Earliest record</span>
                    <strong>7:00 AM</strong>
                  </div>
                  <div>
                    <span>Late time</span>
                    <strong>{row.late_threshold}</strong>
                  </div>
                  <div>
                    <span>Window</span>
                    <strong>{row.schedule_start} - {row.schedule_end}</strong>
                  </div>
                  <div>
                    <span>Required</span>
                    <strong>{formatHours(row.required_hours)} hours</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <section className="weekly-schedule-calendar weekly-schedule-calendar--compact card">
            <div className="weekly-schedule-calendar__header">
              <div>
                <p className="section-kicker">Date exceptions</p>
                <h4>{calendarMonthLabel}</h4>
                <p className="subtle">Green keeps the default 8-hour schedule. Click a date to turn it red for 10 hours, then click again to return it to green.</p>
              </div>
              <div className="weekly-schedule-calendar__controls">
                <button type="button" className="secondary-btn" onClick={() => handleCalendarMonthChange(-1)} disabled={isCalendarSaving}>
                  Previous
                </button>
                <button type="button" className="secondary-btn" onClick={() => setCalendarMonth(getManilaMonth())} disabled={isCalendarSaving}>
                  Current
                </button>
                <button type="button" className="secondary-btn" onClick={() => handleCalendarMonthChange(1)} disabled={isCalendarSaving}>
                  Next
                </button>
              </div>
            </div>

            <div className="weekly-schedule-calendar__legend">
              <span className="weekly-schedule-calendar__legend-item is-green">Default 8 hours</span>
              <span className="weekly-schedule-calendar__legend-item is-red">10-hour exception</span>
            </div>

            <div className="weekly-schedule-calendar__table-wrap">
              <table className="weekly-schedule-calendar__table" aria-label={`${calendarMonthLabel} schedule calendar`}>
                <thead>
                  <tr>
                    {CALENDAR_WEEKDAY_LABELS.map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {calendarWeeks.map((week, weekIndex) => (
                    <tr key={`week-${weekIndex}`}>
                      {week.map((cell) => {
                        if (cell.blank) {
                          return <td key={cell.key} className="weekly-schedule-calendar__cell weekly-schedule-calendar__cell--blank" aria-hidden="true" />;
                        }

                        const override = calendarOverrides[cell.dateKey];
                        const isRed = String(override?.schedule_type || "A").trim().toUpperCase() === "B";
                        const cellStateClass = isRed ? "is-red" : "is-green";

                        return (
                          <td key={cell.key} className={`weekly-schedule-calendar__cell ${cellStateClass} ${cell.isToday ? "is-today" : ""}`.trim()}>
                            <button
                              type="button"
                              className="weekly-schedule-calendar__day"
                              onClick={() => handleCalendarDateToggle(cell.dateKey)}
                              disabled={isCalendarSaving}
                              aria-pressed={isRed}
                              aria-label={`${cell.dateKey} ${isRed ? "10-hour exception" : "default 8-hour schedule"}`}
                            >
                              <span>{cell.day}</span>
                              <strong>{isRed ? "10h" : "8h"}</strong>
                              <small>{isRed ? "Red" : "Green"}</small>
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <div className="weekly-schedule-grid">
          {activeRows.map((row) => (
            <article key={`${selectedCategory}-${row.day_of_week}`} className="weekly-schedule-day-card">
              <div className="weekly-schedule-day-card__heading">
                <p className="section-kicker">Day {row.day_of_week + 1}</p>
                <h4>{row.day_name}</h4>
              </div>

              <div className="weekly-schedule-day-card__grid">
                <label>
                  Late time
                  <input
                    type="time"
                    value={row.late_threshold}
                    onChange={(event) => updateRow(row.day_of_week, "late_threshold", event.target.value)}
                  />
                </label>
                <label>
                  Earliest time
                  <input
                    type="time"
                    value={row.schedule_start}
                    onChange={(event) => updateRow(row.day_of_week, "schedule_start", event.target.value)}
                  />
                </label>
                <label>
                  End time
                  <input
                    type="time"
                    value={row.schedule_end}
                    onChange={(event) => updateRow(row.day_of_week, "schedule_end", event.target.value)}
                  />
                </label>
                <label>
                  Required hours
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="8, 8.5, or 08:00"
                    spellCheck="false"
                    value={row.required_hours}
                    onChange={(event) => updateRow(row.day_of_week, "required_hours", event.target.value)}
                  />
                  <span className="weekly-schedule-day-card__hint">Type the duration manually, like 8, 8.5, or 08:00.</span>
                </label>
              </div>

              <p className="subtle">
                Window {row.schedule_start} - {row.schedule_end} · late after {row.late_threshold} · {formatHours(row.required_hours)} required
              </p>
            </article>
          ))}
        </div>
      )}

      <footer className="weekly-schedule-card__footer">
        {selectedCategory === "regular" ? (
          <p className="hint">Regular schedule changes save automatically. Click a preset or a calendar date and the change is written immediately.</p>
        ) : (
          <>
            <p className="hint">Saving updates only {activeCategory.label} and leaves the other roster untouched.</p>
            <button type="button" className="primary-btn" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : saveLabel}
            </button>
          </>
        )}
      </footer>
    </section>

      {calendarBusyOverlay}
    </>
  );
}
