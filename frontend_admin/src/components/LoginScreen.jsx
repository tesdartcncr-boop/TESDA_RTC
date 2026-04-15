import { useMemo, useState } from "react";
import { getAllowedAuthEmails, isAllowedAuthEmail } from "../services/auth";
import { API_BASE_URL } from "../services/api";
import { supabase } from "../services/supabase";

export default function LoginScreen({ portalName, description, errorMessage = "" }) {
  const allowedEmails = useMemo(() => getAllowedAuthEmails(), []);
  const [email, setEmail] = useState(allowedEmails[0] || "");
  const [otp, setOtp] = useState("");
  const [status, setStatus] = useState(errorMessage || "Enter an approved TESDA email to request an OTP.");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isCodeSent, setIsCodeSent] = useState(false);

  async function requestOtp() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!isAllowedAuthEmail(normalizedEmail)) {
      setStatus("Use one of the approved TESDA email addresses.");
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
      setStatus("OTP sent to your email. Enter the 6-digit code below.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsSending(false);
    }
  }

  async function verifyAndSignIn() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!isAllowedAuthEmail(normalizedEmail)) {
      setStatus("Use one of the approved TESDA email addresses.");
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

      // OTP verified, now sign in with Supabase using passwordless flow
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: true }
      });

      if (error) {
        throw error;
      }

      setStatus("Signed in successfully.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <main className="admin-auth-page">
      <section className="card auth-card admin-auth-card">
        <div>
          <p className="eyebrow admin-eyebrow">Secure access</p>
          <h1>{portalName}</h1>
          <p className="subtle">{description}</p>
        </div>

        <div className="auth-email-list" aria-label="Approved login emails">
          {allowedEmails.map((allowedEmail) => (
            <span className="auth-chip" key={allowedEmail}>
              {allowedEmail}
            </span>
          ))}
        </div>

        <label className="auth-field">
          <span>Email address</span>
          <input
            type="email"
            placeholder="Enter approved email"
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
          <button type="button" onClick={requestOtp} disabled={isSending}>
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