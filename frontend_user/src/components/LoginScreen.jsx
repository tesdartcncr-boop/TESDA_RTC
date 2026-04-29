import { useEffect, useState } from "react";
import { API_BASE_URL, api } from "../services/api";
import { setPortalSession } from "../services/session";

const SAMPLE_FIELDS = [
  {
    key: "a",
    label: "A",
    title: "What are you requesting?",
    placeholder: "Leave application, account review, or another sample request"
  },
  {
    key: "b",
    label: "B",
    title: "Whose record should be checked?",
    placeholder: "Employee name or account holder"
  },
  {
    key: "c",
    label: "C",
    title: "Which office, class, or team should see it?",
    placeholder: "Department, section, or supervisor"
  },
  {
    key: "d",
    label: "D",
    title: "What dates or profile details matter most?",
    placeholder: "Leave dates, profile details, or needed corrections"
  },
  {
    key: "e",
    label: "E",
    title: "Add any note for approval or follow-up.",
    placeholder: "Optional note for the reviewer"
  }
];

const ACTION_CARDS = {
  leave: {
    title: "Leave application",
    description: "Open a sample leave request form beside the login page.",
    badge: "Request form"
  },
  profile: {
    title: "View account profile",
    description: "Select an employee, unlock their profile, and reveal leave balances.",
    badge: "Leave profile"
  }
};

function createEmptySampleAnswers() {
  return SAMPLE_FIELDS.reduce((answers, field) => {
    answers[field.key] = "";
    return answers;
  }, {});
}

function formatLeaveQuantity(value) {
  const numeric = Number(value ?? 0);

  if (!Number.isFinite(numeric)) {
    return "0";
  }

  if (Number.isInteger(numeric)) {
    return String(numeric);
  }

  return numeric.toFixed(2).replace(/\.00$/, "");
}

function notifyServerIssue(message) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }

  window.dispatchEvent(new CustomEvent("server:error", {
    detail: {
      message
    }
  }));
}

export default function LoginScreen({ portalName, description, errorMessage = "", onAuthenticated }) {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [status, setStatus] = useState(errorMessage || "Enter an approved TESDA email to request an OTP.");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isCodeSent, setIsCodeSent] = useState(false);
  const [sampleMode, setSampleMode] = useState(null);
  const [sampleAnswers, setSampleAnswers] = useState(() => createEmptySampleAnswers());
  const [sampleStatus, setSampleStatus] = useState("");
  const [profileEmployees, setProfileEmployees] = useState([]);
  const [profileLeaveTypes, setProfileLeaveTypes] = useState([]);
  const [profileEmployeeId, setProfileEmployeeId] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [profileStatus, setProfileStatus] = useState("");
  const [profileResult, setProfileResult] = useState(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isProfileSubmitting, setIsProfileSubmitting] = useState(false);

  const activeAction = sampleMode ? ACTION_CARDS[sampleMode] : null;
  const selectedProfileEmployee = profileEmployees.find((employee) => String(employee.id) === String(profileEmployeeId)) || null;

  useEffect(() => {
    if (!sampleMode || typeof window === "undefined") {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setSampleMode(null);
        setSampleStatus("");
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sampleMode]);

  function openSampleForm(mode) {
    setSampleMode(mode);
    if (mode === "profile") {
      setProfileEmployees([]);
      setProfileLeaveTypes([]);
      setProfileEmployeeId("");
      setProfilePassword("");
      setProfileStatus("Loading employees and leave types...");
      setProfileResult(null);
      setIsProfileLoading(true);
      setIsProfileSubmitting(false);
      setSampleStatus("");
      return;
    }

    setSampleAnswers(createEmptySampleAnswers());
    setSampleStatus("");
  }

  function closeSampleForm() {
    setSampleMode(null);
    setSampleStatus("");
    setProfileEmployees([]);
    setProfileLeaveTypes([]);
    setProfileEmployeeId("");
    setProfilePassword("");
    setProfileStatus("");
    setProfileResult(null);
    setIsProfileLoading(false);
    setIsProfileSubmitting(false);
  }

  function updateSampleAnswer(fieldKey, value) {
    setSampleAnswers((currentAnswers) => ({
      ...currentAnswers,
      [fieldKey]: value
    }));
  }

  function submitSampleForm(event) {
    event.preventDefault();
    setSampleStatus("Sample form saved locally. Wire this form to an endpoint when you are ready.");
  }

  useEffect(() => {
    if (sampleMode !== "profile") {
      return undefined;
    }

    let cancelled = false;

    async function loadProfileData() {
      setIsProfileLoading(true);
      setProfileStatus("Loading employees and leave types...");

      try {
        const [employees, leaveTypes] = await Promise.all([
          api.getProfileEmployees(),
          api.getProfileLeaveTypes()
        ]);

        if (cancelled) {
          return;
        }

        const nextEmployees = Array.isArray(employees) ? employees : [];
        const nextLeaveTypes = Array.isArray(leaveTypes) ? leaveTypes : [];

        setProfileEmployees(nextEmployees);
        setProfileLeaveTypes(nextLeaveTypes);
        setProfileEmployeeId((currentEmployeeId) => {
          const currentExists = nextEmployees.some((employee) => String(employee.id) === String(currentEmployeeId));
          return currentExists ? currentEmployeeId : String(nextEmployees[0]?.id || "");
        });
        setProfileResult(null);
        setProfilePassword("");
        setProfileStatus(
          nextEmployees.length
            ? "Choose a name and enter the password to reveal leave balances."
            : "No employees found yet."
        );
      } catch (error) {
        if (!cancelled) {
          setProfileStatus(error.message);
        }
      } finally {
        if (!cancelled) {
          setIsProfileLoading(false);
        }
      }
    }

    loadProfileData();

    return () => {
      cancelled = true;
    };
  }, [sampleMode]);

  async function submitProfileForm(event) {
    event.preventDefault();

    if (!profileEmployeeId) {
      setProfileStatus("Select an employee name first.");
      return;
    }

    if (!profilePassword.trim()) {
      setProfileStatus("Enter the employee password.");
      return;
    }

    setIsProfileSubmitting(true);
    setProfileStatus("Checking employee password...");

    try {
      const result = await api.lookupEmployeeProfile({
        employee_id: Number(profileEmployeeId),
        employee_password: profilePassword.trim()
      });

      setProfileResult(result);
      setProfileStatus(`Leave balances unlocked for ${result.employee?.name || "the selected employee"}.`);
    } catch (error) {
      setProfileResult(null);
      setProfileStatus(error.message);
    } finally {
      setIsProfileSubmitting(false);
    }
  }

  async function requestOtp() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setStatus("Enter your TESDA email address.");
      return;
    }

    setIsSending(true);
    setStatus("Sending OTP...");

    try {
      const response = await fetch(`${API_BASE_URL}/auth/otp/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status >= 500) {
          notifyServerIssue("Server error. Please refresh the page.");
        }

        throw new Error(data.detail || "Failed to send OTP");
      }

      setIsCodeSent(true);
      setStatus("OTP generated. Check your email shortly.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send OTP";

      if (/fetch|network/i.test(message)) {
        notifyServerIssue("Server disconnected. Please refresh the page.");
      }

      setStatus(message);
    } finally {
      setIsSending(false);
    }
  }

  async function verifyAndSignIn() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      setStatus("Enter your TESDA email address.");
      return;
    }

    if (!otp.trim()) {
      setStatus("Enter the OTP code from your email.");
      return;
    }

    setIsVerifying(true);
    setStatus("Verifying OTP...");

    try {
      // Verify OTP with backend
      const verifyResponse = await fetch(`${API_BASE_URL}/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, otp_code: otp.trim() })
      });

      const verifyData = await verifyResponse.json().catch(() => ({}));

      if (!verifyResponse.ok) {
        if (verifyResponse.status >= 500) {
          notifyServerIssue("Server error. Please refresh the page.");
        }

        throw new Error(verifyData.detail || "Invalid OTP code");
      }

      const portalSession = verifyData.portal_session;
      if (!portalSession?.access_token) {
        throw new Error("Login session could not be created.");
      }

      const nextSession = {
        access_token: portalSession?.access_token,
        expires_at: portalSession?.expires_at,
        token_type: portalSession?.token_type || "bearer",
        user: { email: verifyData.email || normalizedEmail }
      };

      setPortalSession(nextSession);
      onAuthenticated?.(nextSession);
      setStatus("Access granted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid OTP code";

      if (/fetch|network/i.test(message)) {
        notifyServerIssue("Server disconnected. Please refresh the page.");
      }

      setStatus(message);
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <main className="user-auth-book-page">
      <section className="user-auth-book-shell">
        <article className="user-auth-book-page-panel user-auth-book-page-panel--login">
          <div className="user-auth-book-header">
            <div className="auth-icon-container">
              <svg className="auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <h1>{portalName}</h1>
            <p className="auth-description">{description}</p>
          </div>

          <div className="user-auth-book-login-form">
            <div className="form-group">
              <label htmlFor="email-input" className="form-label">
                <svg className="label-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                </svg> Email Address
              </label>
              <input
                id="email-input"
                type="email"
                autoComplete="email"
                placeholder="your.name@tesda.gov.ph"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="otp-input" className="form-label">
                <svg className="label-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg> One-Time Password
              </label>
              <input
                id="otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                className="form-input"
              />
            </div>

            <div className="auth-actions user-auth-book-login-actions">
              <button 
                type="button" 
                className="btn btn--primary" 
                onClick={requestOtp} 
                disabled={isSending}
              >
                {isSending ? "Sending..." : isCodeSent ? "Resend" : "Send OTP"}
              </button>
              <button 
                type="button" 
                className="btn btn--secondary" 
                onClick={verifyAndSignIn} 
                disabled={isVerifying || !isCodeSent}
              >
                {isVerifying ? "Verifying..." : "Verify"}
              </button>
            </div>
          </div>

          <div className="auth-status-container">
            <p className="auth-status" aria-live="polite">
              {status}
            </p>
          </div>
        </article>

        <article className="user-auth-book-page-panel user-auth-book-page-panel--actions">
          <div className="user-auth-book-header">
            <h2>Quick Forms</h2>
            <p className="actions-description">
              Explore sample forms for common requests. They scale beautifully on any device.
            </p>
          </div>

          <div className="user-auth-book-action-grid">
            {Object.entries(ACTION_CARDS).map(([mode, card]) => (
              <button
                key={mode}
                type="button"
                className={`user-auth-book-action-card user-auth-book-action-card--${mode}`}
                onClick={() => openSampleForm(mode)}
              >
                <svg className="action-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  {mode === 'leave' ? (
                    <>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="9" y1="13" x2="15" y2="13"></line>
                      <line x1="9" y1="17" x2="15" y2="17"></line>
                    </>
                  ) : (
                    <>
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </>
                  )}
                </svg>
                <strong>{card.title}</strong>
                <span className="action-card-meta">{card.badge}</span>
              </button>
            ))}
          </div>
        </article>
      </section>

      {sampleMode ? (
        <div className="user-auth-book-modal" role="presentation">
          <button type="button" className="user-auth-book-modal__backdrop" aria-label="Close sample form" onClick={closeSampleForm} />

          <section
            className="user-auth-book-modal__sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-sample-form-title"
            aria-describedby="user-sample-form-description"
          >
            <div className="user-auth-book-modal__header">
              <div>
                <p className="user-auth-book-kicker">{sampleMode === "profile" ? "Employee profile" : "Sample form"}</p>
                <h3 id="user-sample-form-title">{activeAction.title}</h3>
                <p id="user-sample-form-description" className="hint">
                  {sampleMode === "profile"
                    ? "Select an employee, enter the password, and unlock the leave credits stored in the new database."
                    : `${activeAction.description} The fields below use pages A to E and adjust to every screen size.`}
                </p>
              </div>

              <button type="button" className="secondary-btn" onClick={closeSampleForm}>
                Close
              </button>
            </div>

            {sampleMode === "profile" ? (
              <div className="user-auth-book-profile-modal">
                <div className="user-auth-book-profile-grid">
                  <form className="user-auth-book-modal__form user-auth-book-profile-form" onSubmit={submitProfileForm}>
                    <div className="user-auth-book-profile-form__controls">
                      <label className="form-group">
                        <span className="form-label">Employee name</span>
                        <select
                          className="form-input"
                          value={profileEmployeeId}
                          onChange={(event) => {
                            setProfileEmployeeId(event.target.value);
                            setProfileResult(null);
                          }}
                          disabled={isProfileLoading || !profileEmployees.length}
                        >
                          <option value="">Select an employee</option>
                          {profileEmployees.map((employee) => (
                            <option key={employee.id} value={employee.id}>
                              {employee.name} {employee.category === "jo" ? "• JO" : "• Regular"}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="form-group">
                        <span className="form-label">Employee password</span>
                        <input
                          type="password"
                          autoComplete="off"
                          placeholder="Enter the employee password"
                          value={profilePassword}
                          onChange={(event) => setProfilePassword(event.target.value)}
                          className="form-input"
                        />
                      </label>
                    </div>

                    <div className="auth-actions user-auth-book-login-actions">
                      <button type="submit" className="btn btn--primary" disabled={isProfileSubmitting || isProfileLoading}>
                        {isProfileSubmitting ? "Checking..." : "Show leaves"}
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary"
                        onClick={() => {
                          setProfilePassword("");
                          setProfileResult(null);
                          setProfileStatus(profileEmployees.length ? "Enter the password to reveal leave balances." : "No employee selected.");
                        }}
                        disabled={isProfileLoading}
                      >
                        Clear
                      </button>
                    </div>
                  </form>

                  <div className="user-auth-book-profile-panel">
                    <section className="user-auth-book-profile-result user-auth-book-profile-result--list">
                      <div className="user-auth-book-profile-result__header">
                        <p className="user-auth-book-kicker">Leave types visible to employees</p>
                        <h4>{profileLeaveTypes.length} active leave type{profileLeaveTypes.length === 1 ? "" : "s"}</h4>
                        <p className="subtle">These leave credits come from the new leave registry.</p>
                      </div>

                      <div className="user-auth-book-profile-list">
                        {profileLeaveTypes.length ? profileLeaveTypes.map((leaveType) => (
                          <article key={leaveType.id} className="user-auth-book-profile-pill">
                            <div>
                              <strong>{leaveType.code}</strong>
                              <span>{leaveType.name}</span>
                            </div>
                            {leaveType.description ? <p>{leaveType.description}</p> : null}
                          </article>
                        )) : (
                          <p className="subtle">No active leave types yet.</p>
                        )}
                      </div>
                    </section>

                    <section className="user-auth-book-profile-result">
                      <div className="user-auth-book-profile-result__header">
                        <p className="user-auth-book-kicker">Unlocked profile</p>
                        <h4>{profileResult?.employee?.name || selectedProfileEmployee?.name || "Employee profile"}</h4>
                        <p className="subtle">
                          {profileResult?.employee?.office || selectedProfileEmployee?.office || "Office not set"}
                          {(profileResult?.employee?.category || selectedProfileEmployee?.category)
                            ? ` • ${String(profileResult?.employee?.category || selectedProfileEmployee?.category).toLowerCase() === "jo" ? "Job Order" : "Regular"}`
                            : ""}
                        </p>
                      </div>

                      {profileResult ? (
                        <div className="user-auth-book-profile-balance-list">
                          {profileResult.balances?.length ? profileResult.balances.map((balance) => (
                            <div key={balance.leave_type_id} className="user-auth-book-profile-balance-item">
                              <div>
                                <strong>{balance.code}</strong>
                                <span>{balance.name}</span>
                              </div>
                              <strong>{formatLeaveQuantity(balance.quantity)}</strong>
                            </div>
                          )) : <p className="subtle">No leave balances were found for this employee.</p>}
                        </div>
                      ) : (
                        <p className="subtle user-auth-book-profile-empty">
                          {isProfileLoading
                            ? "Loading employees and leave types..."
                            : "Select a name, enter the password, and the available leave credits will appear here."}
                        </p>
                      )}
                    </section>
                  </div>
                </div>

                <div className="user-auth-book-modal__footer">
                  <p className="auth-status" aria-live="polite">
                    {profileStatus || "Choose an employee and unlock the profile to view leave balances."}
                  </p>
                </div>
              </div>
            ) : (
              <form className="user-auth-book-modal__form" onSubmit={submitSampleForm}>
                <div className="user-auth-book-modal__grid">
                  {SAMPLE_FIELDS.map((field) => (
                    <label key={field.key} className="user-auth-book-question-card">
                      <span className="user-auth-book-question-card__label">Page {field.label}</span>
                      <strong>{field.title}</strong>
                      {field.key === "e" ? (
                        <textarea
                          rows={4}
                          placeholder={field.placeholder}
                          value={sampleAnswers[field.key]}
                          onChange={(event) => updateSampleAnswer(field.key, event.target.value)}
                        />
                      ) : (
                        <input
                          type="text"
                          placeholder={field.placeholder}
                          value={sampleAnswers[field.key]}
                          onChange={(event) => updateSampleAnswer(field.key, event.target.value)}
                        />
                      )}
                    </label>
                  ))}
                </div>

                <div className="user-auth-book-modal__footer">
                  <p className="auth-status" aria-live="polite">
                    {sampleStatus || "Sample answers stay local until you connect this form to a backend endpoint."}
                  </p>
                  <button type="submit" className="primary-btn">
                    Save sample form
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}