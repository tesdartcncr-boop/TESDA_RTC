import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";

function getClockCopy(attendance, leaveType) {
  const hasTimeIn = attendance?.time_in && !["SL", "VL", "OB"].includes(String(attendance.time_in).trim().toUpperCase());
  const hasTimeOut = attendance?.time_out && !["SL", "VL", "OB"].includes(String(attendance.time_out).trim().toUpperCase());

  if (hasTimeIn && hasTimeOut) {
    return {
      isComplete: true,
      title: "Completed today",
      description: "This employee already has a full Time In / Time Out entry for the selected date."
    };
  }

  const normalizedLeaveType = (leaveType || "").trim().toUpperCase();

  if (normalizedLeaveType) {
    return {
      isComplete: false,
      title: "Apply Leave",
      description: `This will record ${normalizedLeaveType} for the selected date and keep Time In / Time Out blank.`
    };
  }

  if (attendance?.time_in) {
    return {
      isComplete: false,
      title: "Record Time Out",
      description: "Time In already exists for today. Enter the password to save Time Out."
    };
  }

  return {
    isComplete: false,
    title: "Record Time In",
    description: "No record exists yet for today. Enter the password to save Time In."
  };
}

export default function EmployeeGrid({ employees, attendanceByEmployeeId = new Map(), onClock, emptyMessage = "No employees found for this category." }) {
  const [activeEmployeeId, setActiveEmployeeId] = useState(null);
  const [password, setPassword] = useState("");
  const [leaveType, setLeaveType] = useState("");
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
    const hasTimeIn = attendance?.time_in && !["SL", "VL", "OB"].includes(String(attendance.time_in).trim().toUpperCase());
    const hasTimeOut = attendance?.time_out && !["SL", "VL", "OB"].includes(String(attendance.time_out).trim().toUpperCase());

    if (hasTimeIn && hasTimeOut) {
      return;
    }

    setActiveEmployeeId(employee.id);
    setPassword("");
    setLeaveType("");
    setErrorMessage("");
    setIsSubmitting(false);
  }

  function closeModal() {
    setActiveEmployeeId(null);
    setPassword("");
    setLeaveType("");
    setErrorMessage("");
    setIsSubmitting(false);
  }

  async function handleClock() {
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
        className={isScrollable ? "employee-grid employee-grid--single employee-grid--scroll" : "employee-grid employee-grid--single"}
        style={isScrollable ? { maxHeight: "calc((72px * 10) + (0.85rem * 9))", overflowY: "auto", paddingRight: "0.35rem" } : undefined}
      >
        {employees.map((employee) => {
          const attendance = attendanceByEmployeeId.get(employee.id);
          const isCompleted = Boolean(
            attendance?.time_in &&
            attendance?.time_out &&
            !["SL", "VL", "OB"].includes(String(attendance.time_in).trim().toUpperCase()) &&
            !["SL", "VL", "OB"].includes(String(attendance.time_out).trim().toUpperCase())
          );

          return (
            <button
              key={employee.id}
              type="button"
              className="employee-card employee-card--button"
              onClick={() => openModal(employee)}
              disabled={isCompleted}
            >
              <span className="employee-name">{employee.name}</span>
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

                <label className="employee-password-field">
                  <span>Password</span>
                  <input
                    type="password"
                    placeholder="Enter employee password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoFocus
                  />
                </label>

                {errorMessage ? <p className="clock-modal__error">{errorMessage}</p> : null}

                <div className="clock-modal__actions">
                  <button type="button" className="secondary-btn" onClick={closeModal} disabled={isSubmitting}>
                    Cancel
                  </button>
                  <button type="button" className="primary-btn" onClick={handleClock} disabled={isSubmitting || !password.trim()}>
                    {isSubmitting ? "Recording..." : clockCopy.title}
                  </button>
                </div>
              </section>
            </div>,
            modalRoot
          )
        : null}
    </>
  );
}
