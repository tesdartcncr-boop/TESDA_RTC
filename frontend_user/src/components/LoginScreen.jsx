import { useMemo, useState } from "react";
import { getAllowedAuthEmails, isAllowedAuthEmail } from "../services/auth";
import { supabase } from "../services/supabase";

export default function LoginScreen({ portalName, description, errorMessage = "" }) {
  const allowedEmails = useMemo(() => getAllowedAuthEmails(), []);
  const [email, setEmail] = useState(allowedEmails[0] || "");
  const [otp, setOtp] = useState("");
  const [status, setStatus] = useState(errorMessage || "Enter an approved TESDA email to request an OTP.");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isCodeSent, setIsCodeSent] = useState(false);

  async function sendOtp() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!isAllowedAuthEmail(normalizedEmail)) {
      setStatus("Use one of the approved TESDA email addresses.");
      return;
    }

    setIsSending(true);
    setStatus("Sending OTP...");

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { shouldCreateUser: true }
      });

      if (error) {
        throw error;
      }

      setIsCodeSent(true);
      setStatus("OTP sent. Check your inbox and enter the code below.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsSending(false);
    }
  }

  async function verifyOtp() {
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
      const { error } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: otp.trim(),
        type: "email"
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
    <main className="page auth-page">
      <section className="surface auth-card">
        <div>
          <p className="eyebrow">Secure access</p>
          <h1>{portalName}</h1>
          <p className="hint">{description}</p>
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
          <button type="button" className="primary-btn" onClick={sendOtp} disabled={isSending}>
            {isSending ? "Sending..." : isCodeSent ? "Resend OTP" : "Send OTP"}
          </button>
          <button type="button" className="secondary-btn" onClick={verifyOtp} disabled={isVerifying || !isCodeSent}>
            {isVerifying ? "Verifying..." : "Verify OTP"}
          </button>
        </div>

        <p className="auth-status">{status}</p>
      </section>
    </main>
  );
}