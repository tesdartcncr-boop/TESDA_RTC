import { useEffect, useState } from "react";
import { api } from "../services/api";

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export default function AuthorizedEmailsPage() {
  const [emails, setEmails] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  const [status, setStatus] = useState("Ready");
  const [isSaving, setIsSaving] = useState(false);
  const enabledCount = emails.filter((emailRow) => emailRow.enabled).length;

  async function loadEmails() {
    setStatus("Loading authorized emails...");
    try {
      const list = await api.listAuthorizedEmails();
      setEmails(list);
      setStatus("Ready");
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => {
    loadEmails();
  }, []);

  async function addEmail() {
    const normalizedEmail = normalizeEmail(newEmail);

    if (!normalizedEmail) {
      setStatus("Enter an email address.");
      return;
    }

    setIsSaving(true);
    setStatus("Saving authorized email...");

    try {
      await api.addAuthorizedEmail({ email: normalizedEmail });
      setNewEmail("");
      await loadEmails();
      setStatus("Authorized email saved.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function setEmailEnabled(emailRow, enabled) {
    setIsSaving(true);
    setStatus(enabled ? "Restoring email..." : "Removing email...");

    try {
      await api.updateAuthorizedEmail(emailRow.id, { enabled });
      await loadEmails();
      setStatus(enabled ? "Authorized email restored." : "Authorized email removed.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="card">
      <h2>Authorized Login Emails</h2>
      <p className="subtle">Manage which email addresses can request OTP access for both portals.</p>
      <p className="subtle">Keep at least one email enabled so the admin portal stays accessible.</p>
      <p className="subtle">Status: {status}</p>

      <div className="toolbar auth-email-toolbar">
        <label className="auth-email-field">
          <span>Email address</span>
          <input
            type="email"
            placeholder="name@tesda.gov.ph"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
          />
        </label>
        <button type="button" onClick={addEmail} disabled={isSaving}>
          Add email
        </button>
      </div>

      <div className="table-container">
        <table className="auth-email-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {emails.length ? (
              emails.map((emailRow) => (
                <tr key={emailRow.id} className={emailRow.enabled ? "" : "is-disabled"}>
                  <td>{emailRow.email}</td>
                  <td>
                    <span className={emailRow.enabled ? "status-pill status-pill--active" : "status-pill status-pill--disabled"}>
                      {emailRow.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                  <td className="actions-cell">
                    {emailRow.enabled ? (
                      <button
                        type="button"
                        className="danger"
                        onClick={() => setEmailEnabled(emailRow, false)}
                        disabled={isSaving || enabledCount <= 1}
                      >
                        Remove
                      </button>
                    ) : (
                      <button type="button" onClick={() => setEmailEnabled(emailRow, true)} disabled={isSaving}>
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="3">
                  <p className="subtle">No authorized emails configured yet.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}