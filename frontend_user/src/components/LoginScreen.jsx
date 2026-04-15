import { useState } from "react";
import { API_BASE_URL } from "../services/api";
import { setPortalSession } from "../services/session";

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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "Failed to send OTP");
      }

      setIsCodeSent(true);
      setStatus("OTP generated. Check your email shortly.");
    } catch (error) {
      setStatus(error.message);
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

      const verifyData = await verifyResponse.json();

      if (!verifyResponse.ok) {
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
      setStatus(error.message);
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <main className="page auth-page">
      <section className="surface auth-card">
        <div>
          <p className="eyebrow">Secure access</p>
          <h1>{portalName}</h1>
          <p className="hint">{description}</p>
        </div>

        <label className="auth-field">
          <span>Email address</span>
          <input
            type="email"
            placeholder="Enter your TESDA email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="auth-field">
          <span>OTP code</span>
          <input
            inputMode="numeric"
            placeholder="Enter the 6-digit code"
            value={otp}
            onChange={(event) => setOtp(event.target.value)}
          />
        </label>

        <div className="auth-actions">
          <button type="button" className="primary-btn" onClick={requestOtp} disabled={isSending}>
            {isSending ? "Sending..." : isCodeSent ? "Resend OTP" : "Send OTP"}
          </button>
          <button type="button" className="secondary-btn" onClick={verifyAndSignIn} disabled={isVerifying || !isCodeSent}>
            {isVerifying ? "Verifying..." : "Verify OTP"}
          </button>
        </div>

        <p className="auth-status">{status}</p>
      </section>
    </main>
  );
}