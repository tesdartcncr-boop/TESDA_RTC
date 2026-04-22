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

function getObAnchorTime(attendance) {
  return String(attendance?.category || "").trim().toLowerCase() === "jo" ? "8:00 AM" : "7:00 AM";
}

function getCategoryBadgeLabel(category) {
  return String(category || "").trim().toLowerCase() === "jo" ? "Job Order" : "Regular";
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
    if (recordedLeaveCode === "OB") {
      const obAnchorTime = getObAnchorTime(attendance);
      return {
        isComplete: false,
        title: "Record Time Out",
        description: `OB time-in is counted from ${obAnchorTime}. Leave the leave type as OB to close it as a full OB day, or switch Leave type to None to clock out normally.`
      };
    }

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
    const obAnchorTime = getObAnchorTime(attendance);
    return {
      badge: leaveType,
      note: leaveType === "OB" && hasTimeIn && !hasTimeOut ? `OB counts from ${obAnchorTime} until Time Out is saved` : "Leave tagged for this date",
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

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export default function EmployeeGrid({ employees, attendanceByEmployeeId = new Map(), onClock, isLoading = false, emptyMessage = "No employees found for this category.", category = "regular" }) {
  const [activeEmployeeId, setActiveEmployeeId] = useState(null);
  const [password, setPassword] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeEmployee = useMemo(
    () => employees.find((employee) => employee.id === activeEmployeeId) || null,
    [activeEmployeeId, employees]
  );
  const activeAttendance = activeEmployee ? attendanceByEmployeeId.get(activeEmployee.id) : null;
  const clockCopy = getClockCopy(activeAttendance, leaveType);
  const categoryBadgeLabel = getCategoryBadgeLabel(category);
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
    if (isLoading) {
      return <p className="empty-state">Loading employees...</p>;
    }

    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <>
      <div className="employee-grid employee-grid--two-up">
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
                <span className="employee-card__badges">
                  <span className="employee-badge">{cardCopy.badge}</span>
                  <span className="employee-badge employee-badge--category">{categoryBadgeLabel}</span>
                </span>
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
                        className="password-toggle--icon"
                        onClick={() => setPasswordVisible((prev) => !prev)}
                        aria-pressed={passwordVisible}
                        aria-label={passwordVisible ? "Hide password" : "Show password"}
                      >
                        <EyeIcon />
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
