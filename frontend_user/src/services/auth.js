const DEFAULT_ALLOWED_EMAILS = ["tesda.mpltp.tapat@gmail.com", "mssabatin@tesda.gov.ph"];

export function getAllowedAuthEmails() {
  const configuredEmails = import.meta.env.VITE_AUTH_ALLOWED_EMAILS || DEFAULT_ALLOWED_EMAILS.join(",");

  return configuredEmails
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedAuthEmail(email) {
  return getAllowedAuthEmails().includes((email || "").trim().toLowerCase());
}