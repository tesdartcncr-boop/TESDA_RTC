import { useState } from "react";
import { API_BASE_URL } from "../services/api";
import { setPortalSession } from "../services/session";

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
          notifyServerIssue("Server unavailable. Changes stay on the page and will retry automatically.");
        }

        throw new Error(data.detail || "Failed to send OTP");
      }

      setIsCodeSent(true);
      setStatus("OTP generated. Check your email shortly.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send OTP";

      if (/fetch|network/i.test(message)) {
        notifyServerIssue("Connection lost. Changes stay on the page and will retry automatically.");
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
          notifyServerIssue("Server unavailable. Changes stay on the page and will retry automatically.");
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
        notifyServerIssue("Connection lost. Changes stay on the page and will retry automatically.");
      }

      setStatus(message);
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <main className="admin-auth-page">
      <section className="admin-auth-card">
        <div className="admin-auth-header">
          <div className="admin-auth-icon-container">
            <svg className="admin-auth-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h1>{portalName}</h1>
          <p className="admin-auth-description">{description}</p>
        </div>

        <div className="admin-auth-form">
          <div className="admin-form-group">
            <label htmlFor="admin-email-input" className="admin-form-label">
              <svg className="admin-label-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
              </svg> Email Address
            </label>
            <input
              id="admin-email-input"
              type="email"
              autoComplete="email"
              placeholder="your.name@tesda.gov.ph"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="admin-form-input"
            />
          </div>

          <div className="admin-form-group">
            <label htmlFor="admin-otp-input" className="admin-form-label">
              <svg className="admin-label-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg> One-Time Password
            </label>
            <input
              id="admin-otp-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              className="admin-form-input"
            />
          </div>

          <div className="admin-auth-actions">
            <button 
              type="button" 
              className="admin-btn admin-btn--primary" 
              onClick={requestOtp} 
              disabled={isSending}
            >
              {isSending ? "Sending..." : isCodeSent ? "Resend" : "Send OTP"}
            </button>
            <button 
              type="button" 
              className="admin-btn admin-btn--secondary" 
              onClick={verifyAndSignIn} 
              disabled={isVerifying || !isCodeSent}
            >
              {isVerifying ? "Verifying..." : "Verify"}
            </button>
          </div>
        </div>

        <div className="admin-auth-status-container">
          <p className="admin-auth-status" aria-live="polite">
            {status}
          </p>
        </div>
      </section>
    </main>
  );
}