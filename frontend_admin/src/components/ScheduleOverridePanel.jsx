import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

const MANILA_TIME_ZONE = "Asia/Manila";

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

export default function ScheduleOverridePanel({
  title = "Schedule Override",
  description = "Set the schedule format and late threshold for one date.",
  saveLabel = "Save Override",
  className = "",
  onSaved = null,
  initialDate,
  category = "regular",
  isModal = false,
  showDateField = true,
  onClose = null
}) {
  const [date, setDate] = useState(() => initialDate || getManilaDate());
  const [scheduleType, setScheduleType] = useState("A");
  const [lateThreshold, setLateThreshold] = useState("08:00");
  const [status, setStatus] = useState("Ready");
  const [hasOverride, setHasOverride] = useState(false);
  const requestIdRef = useRef(0);
  const categoryLabel = category === "jo" ? "Job Order" : "Regular";

  useEffect(() => {
    setDate(initialDate || getManilaDate());
  }, [initialDate]);

  async function loadSchedule(activeDate) {
    const requestId = ++requestIdRef.current;
    setStatus(`Loading ${categoryLabel} schedule...`);

    try {
      const data = await api.getScheduleSettings(activeDate, category);
      if (requestId !== requestIdRef.current) {
        return;
      }

      setScheduleType(data.schedule_type || "A");
      setLateThreshold(data.late_threshold || "08:00");
      setHasOverride(Boolean(data.has_override));
      setStatus(data.has_override ? `${categoryLabel} override loaded` : `Using default ${categoryLabel} schedule`);
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setStatus(error.message);
    }
  }

  useEffect(() => {
    loadSchedule(date);

    return () => {
      requestIdRef.current += 1;
    };
  }, [date, category]);

  useEffect(() => {
    function handleScheduleInvalidate(event) {
      const payloadDate = event?.detail?.payload?.date || event?.detail?.date || "";
      const payloadCategory = event?.detail?.payload?.category || event?.detail?.category || "";
      if (payloadCategory && payloadCategory !== category) {
        return;
      }

      if (!payloadDate || payloadDate === date) {
        loadSchedule(date);
      }
    }

    window.addEventListener("schedule-settings:invalidate", handleScheduleInvalidate);
    return () => window.removeEventListener("schedule-settings:invalidate", handleScheduleInvalidate);
  }, [date, category]);

  useEffect(() => {
    if (!isModal) {
      return undefined;
    }

    function handleEscape(event) {
      if (event.key === "Escape" && typeof onClose === "function") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isModal, onClose]);

  function handleClose() {
    if (typeof onClose === "function") {
      onClose();
    }
  }

  async function saveSchedule() {
    setStatus("Saving schedule...");

    try {
      const data = await api.setScheduleSettings({
        date,
        category,
        schedule_type: scheduleType,
        late_threshold: lateThreshold
      });

      setScheduleType(data.schedule_type || scheduleType);
      setLateThreshold(data.late_threshold || lateThreshold);
      setHasOverride(Boolean(data.has_override));
      setStatus(`Schedule saved for ${date}`);

      if (typeof onSaved === "function") {
        await onSaved(data);
      }

      if (isModal) {
        handleClose();
      }
    } catch (error) {
      setStatus(error.message);
    }
  }

  const panel = (
    <section className={`card schedule-override-card ${isModal ? "schedule-override-card--modal" : ""} ${className}`.trim()}>
      <header className="schedule-override-card__header">
        <div>
          <p className="section-kicker">Day rule</p>
          <h3>{title}</h3>
          <p className="subtle">{description}</p>
        </div>
        <div className="schedule-override-card__header-actions">
          <div className="status-pill status-pill--live">{hasOverride ? "Override active" : "Default schedule"}</div>
          {isModal ? (
            <button type="button" className="secondary-btn schedule-override-card__close" onClick={handleClose}>
              Close
            </button>
          ) : null}
        </div>
      </header>

      <p className="subtle">Status: {status}</p>
  <p className="subtle">Category: {categoryLabel}</p>

      <div className="toolbar schedule-override-card__toolbar">
        {showDateField ? (
          <label>
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        ) : null}
        <label>
          Schedule Format
          <select value={scheduleType} onChange={(event) => setScheduleType(event.target.value)}>
            <option value="A">A (08:00-17:00)</option>
            <option value="B">B (08:00-19:00)</option>
          </select>
        </label>
        <label>
          Late Threshold
          <input type="time" value={lateThreshold} onChange={(event) => setLateThreshold(event.target.value)} />
        </label>
        <button type="button" onClick={saveSchedule}>
          {saveLabel}
        </button>
      </div>

      <p className="hint">Saving recalculates every attendance row for that date and refreshes the master sheet cache.</p>
    </section>
  );

  if (!isModal) {
    return panel;
  }

  if (typeof document === "undefined" || !document.body) {
    return panel;
  }

  return createPortal(
    <div className="schedule-override-modal" role="presentation" onClick={handleClose}>
      <div className="master-sheet-modal__surface" role="presentation" onClick={(event) => event.stopPropagation()}>
        {panel}
      </div>
    </div>,
    document.body
  );
}