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

const CATEGORY_LABELS = {
  regular: "Regular",
  jo: "Job Order"
};

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
  return referenceDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });
}

function shiftMonth(monthKey, offset) {
  const [year, month] = monthKey.split("-").map(Number);
  const shiftedDate = new Date(Date.UTC(year, month - 1 + offset, 1, 12));
  const nextYear = shiftedDate.getUTCFullYear();
  const nextMonth = String(shiftedDate.getUTCMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}`;
}

function getMonthBounds(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const monthText = String(month).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();

  return {
    dateFrom: `${year}-${monthText}-01`,
    dateTo: `${year}-${monthText}-${String(lastDay).padStart(2, "0")}`
  };
}

function buildCalendarCells(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDate = new Date(Date.UTC(year, month - 1, 1, 12));
  const daysInMonth = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
  const leadingBlankCount = (firstDate.getUTCDay() + 6) % 7;
  const todayKey = getManilaDate();
  const cells = [];

  for (let index = 0; index < leadingBlankCount; index += 1) {
    cells.push({
      blank: true,
      key: `blank-start-${monthKey}-${index}`
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const date = new Date(Date.UTC(year, month - 1, day, 12));

    cells.push({
      blank: false,
      key: dateKey,
      dateKey,
      day,
      weekday: (date.getUTCDay() + 6) % 7,
      isToday: dateKey === todayKey
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      blank: true,
      key: `blank-end-${monthKey}-${cells.length}`
    });
  }

  return cells;
}

function chunkCalendarCells(cells) {
  const rows = [];
  for (let index = 0; index < cells.length; index += 7) {
    rows.push(cells.slice(index, index + 7));
  }
  return rows;
}

function buildOverridesMap(data) {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.overrides)
      ? data.overrides
      : Array.isArray(data?.data)
        ? data.data
        : [];

  const overrides = {};
  rows.forEach((row) => {
    const dateKey = String(row?.date || row?.date_key || "").trim();
    if (!dateKey) {
      return;
    }

    overrides[dateKey] = {
      date: dateKey,
      schedule_type: String(row?.schedule_type || "B").trim().toUpperCase(),
      late_threshold: String(row?.late_threshold || "").trim()
    };
  });

  return overrides;
}

function countRedOverrides(overrides) {
  return Object.values(overrides).reduce((count, item) => {
    return String(item?.schedule_type || "").trim().toUpperCase() === "B" ? count + 1 : count;
  }, 0);
}

function formatDecimalHours(value) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return "8";
  }

  if (Number.isInteger(numeric)) {
    return String(numeric);
  }

  return String(Number(numeric.toFixed(2)));
}

function normalizeRequiredHours(value) {
  if (value === undefined || value === null || value === "") {
    return "8";
  }

  if (typeof value === "number") {
    return value > 24 ? formatDecimalHours(value / 60) : formatDecimalHours(value);
  }

  const text = String(value).trim();
  if (!text) {
    return "8";
  }

  if (text.includes(":")) {
    const [hoursText, minutesText = "0"] = text.split(":");
    const hours = Number(hoursText);
    const minutes = Number(minutesText);
    if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
      return formatDecimalHours(hours + minutes / 60);
    }
  }

  const numeric = Number(text);
  if (!Number.isNaN(numeric)) {
    return numeric > 24 ? formatDecimalHours(numeric / 60) : formatDecimalHours(numeric);
  }

  return text;
}

function formatHours(value) {
  return normalizeRequiredHours(value);
}

function normalizeTimeValue(value, fallback) {
  const text = String(value || "").trim();
  if (!text) {
    return fallback;
  }

  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return fallback;
  }

  const hours = String(Number(match[1])).padStart(2, "0");
  const minutes = String(Number(match[2])).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getDefaultLateThreshold(category, dayOfWeek) {
  if (category === "jo") {
    return dayOfWeek < 5 ? "08:01" : "09:01";
  }

  return dayOfWeek === 0 ? "08:01" : "10:01";
}

function buildDefaultRow(dayOfWeek, category = "jo") {
  const isRegular = category === "regular";
  return {
    category,
    category_label: CATEGORY_LABELS[category] || "Weekly",
    day_of_week: dayOfWeek,
    day_name: WEEKDAYS[dayOfWeek].day_name,
    schedule_start: "08:00",
    schedule_end: "17:00",
    late_threshold: getDefaultLateThreshold(category, dayOfWeek),
    required_hours: "8",
    schedule_type: isRegular ? "A" : "B",
    has_override: false
  };
}

function normalizeRows(rows, category = "jo") {
  const rowsByDay = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const dayOfWeek = Number(row?.day_of_week);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return;
    }

    const rowCategory = String(row?.category || category).trim().toLowerCase() === "regular" ? "regular" : "jo";
    rowsByDay.set(dayOfWeek, {
      category: rowCategory,
      category_label: rowCategory === "regular" ? "Regular" : "Job Order",
      day_of_week: dayOfWeek,
      day_name: WEEKDAYS[dayOfWeek].day_name,
      schedule_start: normalizeTimeValue(row?.schedule_start, "08:00"),
      schedule_end: normalizeTimeValue(row?.schedule_end, "17:00"),
      late_threshold: normalizeTimeValue(row?.late_threshold, getDefaultLateThreshold(rowCategory, dayOfWeek)),
      required_hours: normalizeRequiredHours(row?.required_hours ?? row?.required_minutes),
      schedule_type: String(row?.schedule_type || (rowCategory === "regular" ? "A" : "B")).trim().toUpperCase(),
      has_override: Boolean(row?.has_override)
    });
  });

  return WEEKDAYS.map((day) => rowsByDay.get(day.day_of_week) || buildDefaultRow(day.day_of_week, category));
}

export default function WeeklySchedulePanel({
  title = "Weekly Schedule Calendar",
  description = "Regular and Job Order each get their own date exception calendar. Click any date to turn it red for a 10-hour exception, then use the weekly grid to fine-tune Job Order rules.",
  saveLabel = "Save Weekly Schedule",
  className = "",
  onSaved
}) {
  const [selectedCategory, setSelectedCategory] = useState("regular");
  const [drafts, setDrafts] = useState(() => ({
    jo: normalizeRows([], "jo")
  }));
  const [loadedCategories, setLoadedCategories] = useState({ jo: false });
  const [status, setStatus] = useState("Regular schedule ready");
  const [isSaving, setIsSaving] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => getManilaMonth());
  const [calendarOverrides, setCalendarOverrides] = useState({});
  const [calendarStatus, setCalendarStatus] = useState("No red dates yet");
  const [isCalendarSaving, setIsCalendarSaving] = useState(false);
  const [calendarBusyVisible, setCalendarBusyVisible] = useState(false);
  const [calendarBusyMessage, setCalendarBusyMessage] = useState("");

  const requestIdRef = useRef(0);
  const calendarLoadRequestRef = useRef(0);
  const calendarBusyTimerRef = useRef(null);
  const calendarOverridesCacheRef = useRef(new Map());

  const activeCategoryLabel = CATEGORY_LABELS[selectedCategory] || "Weekly";
  const isRegularView = selectedCategory === "regular";
  const activeRows = isRegularView ? [] : drafts.jo || normalizeRows([], "jo");
  const calendarCells = useMemo(() => buildCalendarCells(calendarMonth), [calendarMonth]);
  const calendarWeeks = useMemo(() => chunkCalendarCells(calendarCells), [calendarCells]);
  const calendarMonthLabel = useMemo(() => formatMonthLabel(calendarMonth), [calendarMonth]);
  const calendarRows = useMemo(() => {
    return calendarWeeks.map((week, weekIndex) => (
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
                aria-label={`${cell.dateKey} ${activeCategoryLabel} ${isRed ? "10-hour exception" : "default 8-hour schedule"}`}
              >
                <span>{cell.day}</span>
                <strong>{isRed ? "10h" : "8h"}</strong>
                <small>{isRed ? "Red" : "Green"}</small>
              </button>
            </td>
          );
        })}
      </tr>
    ));
  }, [activeCategoryLabel, calendarOverrides, calendarWeeks, handleCalendarDateToggle, isCalendarSaving]);
  const calendarHeaderCells = CALENDAR_WEEKDAY_LABELS.map((label) => (
    <th key={label} scope="col">
      {label}
    </th>
  ));

  const jobOrderCards = isRegularView
    ? null
    : activeRows.map((row) => (
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
      ));

  useEffect(() => {
    return () => {
      if (calendarBusyTimerRef.current !== null) {
        window.clearTimeout(calendarBusyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    loadCalendarOverrides({ category: selectedCategory, monthKey: calendarMonth }).catch(() => {});

    function handleScheduleInvalidate(event) {
      const payloadDate = event?.detail?.payload?.date || event?.detail?.date || "";
      const payloadCategory = event?.detail?.payload?.category || event?.detail?.category || "";
      if (payloadCategory && payloadCategory !== selectedCategory) {
        return;
      }

      if (payloadDate && !payloadDate.startsWith(calendarMonth)) {
        return;
      }

      const cacheKey = `${selectedCategory}:${calendarMonth}`;
      calendarOverridesCacheRef.current.delete(cacheKey);
      if (mounted) {
        loadCalendarOverrides({ category: selectedCategory, monthKey: calendarMonth, forceRefresh: true }).catch(() => {});
      }
    }

    window.addEventListener("schedule-settings:invalidate", handleScheduleInvalidate);

    return () => {
      calendarLoadRequestRef.current += 1;
      window.removeEventListener("schedule-settings:invalidate", handleScheduleInvalidate);
      setIsCalendarSaving(false);
      endCalendarBusy();
      mounted = false;
    };
  }, [selectedCategory, calendarMonth]);

  useEffect(() => {
    if (isRegularView) {
      setStatus("Regular schedule ready");
      return undefined;
    }

    let mounted = true;

    async function loadWeeklySchedule() {
      if (loadedCategories.jo) {
        setStatus(`${CATEGORY_LABELS.jo} schedule ready`);
        return;
      }

      const requestId = ++requestIdRef.current;
      setStatus(`Loading ${CATEGORY_LABELS.jo} schedule...`);

      try {
        const data = await api.getWeeklySchedules("jo");
        if (!mounted || requestId !== requestIdRef.current) {
          return;
        }

        const normalizedRows = normalizeRows(data, "jo");
        setDrafts((current) => ({
          ...current,
          jo: normalizedRows
        }));
        setLoadedCategories((current) => ({
          ...current,
          jo: true
        }));
        setStatus(`${CATEGORY_LABELS.jo} schedule loaded`);
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
  }, [isRegularView, loadedCategories.jo]);

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

  function getCalendarCacheKey(category, monthKey) {
    return `${category}:${monthKey}`;
  }

  function updateCalendarCache(category, monthKey, overrides) {
    calendarOverridesCacheRef.current.set(getCalendarCacheKey(category, monthKey), {
      savedAt: Date.now(),
      data: overrides
    });
  }

  async function loadCalendarOverrides({ category = selectedCategory, monthKey = calendarMonth, forceRefresh = false } = {}) {
    const cacheKey = getCalendarCacheKey(category, monthKey);
    const cacheEntry = calendarOverridesCacheRef.current.get(cacheKey);
    if (!forceRefresh && cacheEntry && Date.now() - cacheEntry.savedAt < CALENDAR_OVERRIDE_CACHE_TTL_MS) {
      setCalendarOverrides(cacheEntry.data);
      const cachedCount = countRedOverrides(cacheEntry.data);
      setCalendarStatus(cachedCount ? `${cachedCount} red date${cachedCount === 1 ? "" : "s"} loaded` : "No red dates yet");
      return cacheEntry.data;
    }

    const requestId = ++calendarLoadRequestRef.current;
    const loadingMessage = `Loading ${CATEGORY_LABELS[category] || "Weekly"} ${formatMonthLabel(monthKey)} calendar...`;
    const { dateFrom, dateTo } = getMonthBounds(monthKey);

    setIsCalendarSaving(true);
    setCalendarStatus(loadingMessage);
    beginCalendarBusy(loadingMessage);

    try {
      const data = await api.getScheduleOverrides(dateFrom, dateTo, category);
      if (requestId !== calendarLoadRequestRef.current) {
        return {};
      }

      const nextOverrides = buildOverridesMap(data);
      updateCalendarCache(category, monthKey, nextOverrides);
      setCalendarOverrides(nextOverrides);
      const redCount = countRedOverrides(nextOverrides);
      setCalendarStatus(redCount ? `${redCount} red date${redCount === 1 ? "" : "s"} loaded` : "No red dates yet");
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

  function handleCategoryChange(nextCategory) {
    if (nextCategory === selectedCategory) {
      return;
    }

    setSelectedCategory(nextCategory);
    if (nextCategory === "regular") {
      setStatus("Regular schedule ready");
      return;
    }

    setStatus(`Loading ${CATEGORY_LABELS[nextCategory] || "Weekly"} schedule...`);
  }

  function handleCalendarMonthChange(offset) {
    setCalendarMonth((currentMonth) => shiftMonth(currentMonth, offset));
  }

  async function handleCalendarDateToggle(dateKey) {
    if (isCalendarSaving) {
      return;
    }

    const category = selectedCategory;
    const monthKey = calendarMonth;
    setIsCalendarSaving(true);
    beginCalendarBusy(`Updating ${dateKey} schedule...`);
    setCalendarStatus(`Updating ${dateKey}...`);

    try {
      const data = await api.toggleScheduleOverride({ date: dateKey, category });

      setCalendarOverrides((currentOverrides) => {
        const nextOverrides = { ...currentOverrides };
        if (data.enabled) {
          nextOverrides[dateKey] = {
            date: dateKey,
            schedule_type: String(data.schedule_type || "B").trim().toUpperCase(),
            late_threshold: String(data.late_threshold || "").trim()
          };
        } else {
          delete nextOverrides[dateKey];
        }

        updateCalendarCache(category, monthKey, nextOverrides);
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
    if (isRegularView) {
      return;
    }

    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      jo: (currentDrafts.jo || normalizeRows([], "jo")).map((row) => (
        row.day_of_week === dayOfWeek
          ? {
              ...row,
              [field]: value
            }
          : row
      ))
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
          required_hours: String(row.required_hours).trim()
        }))
      };

      const data = await api.setWeeklySchedules(payload);
      const savedRows = Array.isArray(data?.schedules) ? data.schedules : rowsToSave;
      const normalizedRows = normalizeRows(savedRows, category);
      setDrafts((currentDrafts) => ({
        ...currentDrafts,
        [category]: normalizedRows
      }));
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
    if (isRegularView) {
      return;
    }

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
            <div className="status-pill status-pill--live">{isRegularView ? "8-hour default" : `${activeCategoryLabel} schedule`}</div>
            <p className="subtle">Status: {isRegularView ? calendarStatus : `${status} • ${calendarStatus}`}</p>
          </div>
        </header>

        <div className="weekly-schedule-switcher" role="tablist" aria-label="Weekly schedule category">
          <button
            type="button"
            role="tab"
            aria-selected={isRegularView}
            className={isRegularView ? "weekly-schedule-switcher__button is-active" : "weekly-schedule-switcher__button"}
            onClick={() => handleCategoryChange("regular")}
            disabled={isSaving || isCalendarSaving}
          >
            <strong>Regular</strong>
            <span>Permanent staff schedule</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isRegularView}
            className={!isRegularView ? "weekly-schedule-switcher__button is-active" : "weekly-schedule-switcher__button"}
            onClick={() => handleCategoryChange("jo")}
            disabled={isSaving || isCalendarSaving}
          >
            <strong>Job Order</strong>
            <span>JO schedule</span>
          </button>
        </div>

        <div className="weekly-schedule-summary-grid">
          {isRegularView ? (
            <>
              <article className="weekly-schedule-summary-card">
                <span>Required hours</span>
                <strong>8 hours</strong>
                <p>Regular stays fixed at 8 hours.</p>
              </article>
              <article className="weekly-schedule-summary-card">
                <span>Earliest record</span>
                <strong>7:00 AM</strong>
                <p>Earlier punches are recorded at 7:00 AM for regular employees.</p>
              </article>
              <article className="weekly-schedule-summary-card">
                <span>Monday late</span>
                <strong>8:01 AM</strong>
                <p>Monday keeps the early late threshold for regular employees.</p>
              </article>
              <article className="weekly-schedule-summary-card">
                <span>Other days late</span>
                <strong>10:01 AM</strong>
                <p>Tuesday to Sunday keep the default late threshold until a red exception is applied.</p>
              </article>
              <article className="weekly-schedule-summary-card">
                <span>Lunch break</span>
                <strong>12:00 PM - 1:00 PM</strong>
                <p>Lunch is excluded from credited hours and undertime calculations.</p>
              </article>
            </>
          ) : (
            <>
              <article className="weekly-schedule-summary-card">
                <span>Supported shifts</span>
                <strong>8 or 10 hours</strong>
                <p>Job Order keeps the same 8-hour and 10-hour schedule lengths.</p>
              </article>
              <article className="weekly-schedule-summary-card">
                <span>Calculation floor</span>
                <strong>8:00 AM</strong>
                <p>Earlier punches stay on the record, but Job Order calculations start at 8:00 AM.</p>
              </article>
              <article className="weekly-schedule-summary-card">
                <span>Weekday late</span>
                <strong>8:01 AM</strong>
                <p>Monday to Friday use the Job Order late threshold.</p>
              </article>
              <article className="weekly-schedule-summary-card">
                <span>Weekend late</span>
                <strong>9:01 AM</strong>
                <p>Saturday and Sunday use the later Job Order threshold.</p>
              </article>
              <article className="weekly-schedule-summary-card">
                <span>OB anchor</span>
                <strong>8:00 AM</strong>
                <p>OB time-in is counted from 8:00 AM for Job Order employees.</p>
              </article>
            </>
          )}
        </div>

        <section className="weekly-schedule-calendar weekly-schedule-calendar--compact card">
          <div className="weekly-schedule-calendar__header">
            <div>
              <p className="section-kicker">Date exceptions</p>
              <h4>{calendarMonthLabel}</h4>
              <p className="subtle">
                {isRegularView
                  ? "Green keeps the default 8-hour schedule. Click a date to turn it red for 10 hours, then click again to return it to green."
                  : "Green keeps the Job Order default schedule. Click a date to turn it red for 10 hours, then click again to return it to green."}
              </p>
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
                <tr>{calendarHeaderCells}</tr>
              </thead>
              <tbody>{calendarRows}</tbody>
            </table>
          </div>
        </section>

        {!isRegularView ? <div className="weekly-schedule-grid">{jobOrderCards}</div> : null}

        <footer className="weekly-schedule-card__footer">
          {isRegularView ? (
            <p className="hint">Regular stays fixed at 8 hours. Click a calendar date to turn it red for the 10-hour exception.</p>
          ) : (
            <>
              <p className="hint">Saving updates only {activeCategoryLabel} and leaves the other roster untouched.</p>
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
