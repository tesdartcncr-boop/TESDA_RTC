import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";

const LEAVE_CODES = new Set(["SL", "VL", "OB"]);

function normalizeToken(value) {
  return (value || "").trim().toUpperCase();
}

function isLeaveCode(value) {
  return LEAVE_CODES.has(normalizeToken(value));
}

function getAttendanceLeaveCode(attendance) {
  return normalizeToken(attendance?.leave_type) || (isLeaveCode(attendance?.time_in) ? normalizeToken(attendance.time_in) : "") || (isLeaveCode(attendance?.time_out) ? normalizeToken(attendance.time_out) : "");
}

function getClockCopy(attendance, leaveType) {
  const recordedLeaveCode = getAttendanceLeaveCode(attendance);
  const normalizedLeaveType = normalizeToken(leaveType);
  const hasTimeIn = Boolean(attendance?.time_in);
  const hasTimeOut = Boolean(attendance?.time_out);

  if (hasTimeIn && hasTimeOut) {
    return {
      isComplete: true,
      title: "Completed today",
      description: recordedLeaveCode
        ? `This ${recordedLeaveCode} leave already has Time In / Time Out recorded.`
        : "This employee already has a full Time In / Time Out entry for the selected date."
    };
  }

  if (hasTimeIn && !hasTimeOut) {
    return {
      isComplete: false,
      title: "Record Time Out",
      description: recordedLeaveCode
        ? `This ${recordedLeaveCode} leave already has Time In recorded. Enter the password to save Time Out.`
        : "Time In already exists for today. Enter the password to save Time Out."
    };
  }

  if (normalizedLeaveType) {
    return {
      isComplete: false,
      title: "Apply Leave",
      description: `This will record ${normalizedLeaveType} in Time In. Use it again to save ${normalizedLeaveType} in Time Out.`
    };
  }

  return {
    isComplete: false,
    title: "Record Time In",
    description: "No record exists yet for today. Enter the password to save Time In."
  };
}

function getRosterCardCopy(attendance) {
  const leaveType = getAttendanceLeaveCode(attendance);
  const hasTimeIn = Boolean(attendance?.time_in);
  const hasTimeOut = Boolean(attendance?.time_out);

  function formatRosterTime(field) {
    if (!attendance) {
      return "—";
    }

    const value = attendance[field] || "";
    const normalizedValue = normalizeToken(value);

    if (field === "time_in") {
      if (leaveType) {
        return leaveType;
      }

      if (normalizedValue && isLeaveCode(normalizedValue)) {
        return normalizedValue;
      }
    }

    if (field === "time_out" && normalizedValue && isLeaveCode(normalizedValue)) {
      return normalizedValue;
    }

    return value || "—";
  }

  if (hasTimeIn && hasTimeOut) {
    return {
      badge: leaveType || "Complete",
      note: leaveType ? `${leaveType} leave already completed` : "Time In and Time Out already recorded",
      tone: leaveType ? "is-leave" : "is-complete",
      timeIn: formatRosterTime("time_in"),
      timeOut: formatRosterTime("time_out")
    };
  }

  if (leaveType) {
    return {
      badge: leaveType,
      note: "Leave tagged for this date",
      tone: "is-leave",
      timeIn: formatRosterTime("time_in"),
      timeOut: formatRosterTime("time_out")
    };
  }

  if (hasTimeIn) {
    return {
      badge: "Clock out",
      note: `Time In saved at ${attendance.time_in}`,
      tone: "is-open",
      timeIn: formatRosterTime("time_in"),
      timeOut: formatRosterTime("time_out")
    };
  }

  return {
    badge: "Clock in",
    note: "Tap the card to start a record",
    tone: "is-open",
    timeIn: "—",
    timeOut: "—"
  };
}

function EyeIcon({ isOpen }) {
  return isOpen ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5c5.5 0 9.7 4.3 11 7-1.3 2.7-5.5 7-11 7S2.3 14.7 1 12c1.3-2.7 5.5-7 11-7Zm0 2c-3.7 0-7 2.6-8.7 5 1.7 2.4 5 5 8.7 5s7-2.6 8.7-5C19 9.6 15.7 7 12 7Zm0 1.8A3.2 3.2 0 1 1 12 15a3.2 3.2 0 0 1 0-6.2Zm0 2A1.2 1.2 0 1 0 12 13a1.2 1.2 0 0 0 0-2.4Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m2.2 3.6 18.2 18.2-1.4 1.4-3.3-3.3c-1.4.7-3 .9-3.7.9-5.5 0-9.7-4.3-11-7 .8-1.6 2.2-3.5 4.1-5.1L.8 5 2.2 3.6Zm7.1 7.1a3.2 3.2 0 0 0 4 4l-4-4Zm-2.7-2.7 2.1 2.1a5.2 5.2 0 0 1 7.1 7.1l1.7 1.7C18 17 22 12.8 23 10c-1.3-2.7-5.5-7-11-7-1.4 0-3.1.3-4.9 1.3ZM12 7a5 5 0 0 1 5 5c0 .4 0 .8-.1 1.1l-1.8-1.8A3.2 3.2 0 0 0 12 8.8c-.4 0-.8.1-1.1.2L9 7.1c.9-.1 1.9-.1 3-.1Zm-7.8 5c1.7 2.4 5 5 8.8 5 .7 0 1.5-.1 2.2-.3l-1.8-1.8A3.2 3.2 0 0 1 9.1 11L6.8 8.7C5.2 9.8 3.9 11.2 4.2 12Z" />
    </svg>
  );
}

export default function EmployeeGrid({ employees, attendanceByEmployeeId = new Map(), onClock, emptyMessage = "No employees found for this category." }) {
  const [activeEmployeeId, setActiveEmployeeId] = useState(null);
  const [password, setPassword] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isScrollable = employees.length > 10;

  const activeEmployee = useMemo(
    () => employees.find((employee) => employee.id === activeEmployeeId) || null,
    [activeEmployeeId, employees]
  );
  const activeAttendance = activeEmployee ? attendanceByEmployeeId.get(activeEmployee.id) : null;
  const clockCopy = getClockCopy(activeAttendance, leaveType);
  const modalRoot = typeof document === "undefined" ? null : document.body;

  useEffect(() => {
    if (!activeEmployee) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setActiveEmployeeId(null);
        setPassword("");
        setLeaveType("");
        setPasswordVisible(false);
        setErrorMessage("");
        setIsSubmitting(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeEmployee]);

  useEffect(() => {
    if (!activeEmployee || typeof document === "undefined") {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [activeEmployee]);

  function openModal(employee) {
    const attendance = attendanceByEmployeeId.get(employee.id);
    const hasTimeIn = Boolean(attendance?.time_in);
    const hasTimeOut = Boolean(attendance?.time_out);

    if (hasTimeIn && hasTimeOut) {
      return;
    }

    setActiveEmployeeId(employee.id);
    setPassword("");
    setLeaveType(getAttendanceLeaveCode(attendance));
    setPasswordVisible(false);
    setErrorMessage("");
    setIsSubmitting(false);
  }

  function closeModal() {
    setActiveEmployeeId(null);
    setPassword("");
    setLeaveType("");
    setPasswordVisible(false);
    setErrorMessage("");
    setIsSubmitting(false);
  }

  async function handleClock(event) {
    event?.preventDefault();

    if (!activeEmployee) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      await onClock(activeEmployee.id, password, leaveType || null);
      closeModal();
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!employees.length) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <>
      <div
        className={isScrollable ? "employee-grid employee-grid--two-up employee-grid--scroll" : "employee-grid employee-grid--two-up"}
        style={isScrollable ? { maxHeight: "calc((7rem * 6) + (0.85rem * 5))", overflowY: "auto", paddingRight: "0.35rem" } : undefined}
      >
        {employees.map((employee, index) => {
          const attendance = attendanceByEmployeeId.get(employee.id);
          const cardCopy = getRosterCardCopy(attendance);
          const isCompleted = Boolean(attendance?.time_in && attendance?.time_out);

          return (
            <button
              key={employee.id}
              type="button"
              className={`employee-card employee-card--button ${cardCopy.tone}`}
              style={{ animationDelay: `${index * 24}ms` }}
              onClick={() => openModal(employee)}
              disabled={isCompleted}
            >
              <span className="employee-card__copy">
                <span className="employee-badge">{cardCopy.badge}</span>
                <span className="employee-name">{employee.name}</span>
                <span className="employee-card__note">{cardCopy.note}</span>
                <span className="employee-card__times" aria-label={`Time in and time out for ${employee.name}`}>
                  <span className="employee-time-chip">
                    <span>Time In</span>
                    <strong>{cardCopy.timeIn}</strong>
                  </span>
                  <span className="employee-time-chip employee-time-chip--out">
                    <span>Time Out</span>
                    <strong>{cardCopy.timeOut}</strong>
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {activeEmployee && modalRoot
        ? createPortal(
            <div className="clock-modal-backdrop" role="presentation" onClick={closeModal}>
              <section
                className="clock-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="clock-modal-title"
                onClick={(event) => event.stopPropagation()}
              >
                <form className="clock-modal__form" onSubmit={handleClock}>
                  <div className="clock-modal__copy">
                    <p className="section-kicker">Time In / Time Out</p>
                    <h3 id="clock-modal-title">{activeEmployee.name}</h3>
                    <p className="hint">{clockCopy.description}</p>
                  </div>

                  <label className="employee-password-field">
                    <span>Leave type (optional)</span>
                    <select value={leaveType} onChange={(event) => setLeaveType(event.target.value)}>
                      <option value="">None</option>
                      <option value="SL">SL</option>
                      <option value="VL">VL</option>
                      <option value="OB">OB</option>
                    </select>
                  </label>

                  <label className="employee-password-field employee-password-field--icon">
                    <span>Password</span>
                    <div className="password-input-shell">
                      <input
                        type={passwordVisible ? "text" : "password"}
                        placeholder="Enter employee password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="password-toggle password-toggle--icon"
                        onClick={() => setPasswordVisible((prev) => !prev)}
                        aria-pressed={passwordVisible}
                        aria-label={passwordVisible ? "Hide password" : "Show password"}
                      >
                        <EyeIcon isOpen={passwordVisible} />
                      </button>
                    </div>
                  </label>

                  {errorMessage ? <p className="clock-modal__error">{errorMessage}</p> : null}

                  <div className="clock-modal__actions">
                    <button type="button" className="secondary-btn" onClick={closeModal} disabled={isSubmitting}>
                      Cancel
                    </button>
                    <button type="submit" className="primary-btn" disabled={isSubmitting || !password.trim()}>
                      {isSubmitting ? "Recording..." : clockCopy.title}
                    </button>
                  </div>
                </form>
              </section>
            </div>,
            modalRoot
          )
        : null}
    </>
  );
}
