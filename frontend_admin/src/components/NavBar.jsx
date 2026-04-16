const NAV_ITEMS = [
  { id: "employees", label: "Employees" },
  { id: "master", label: "Master Sheet" },
  { id: "schedule", label: "Schedule Settings" },
  { id: "authEmails", label: "Authorized Emails" },
  { id: "reports", label: "Reports" },
  { id: "backups", label: "Backup Center" }
];

export default function NavBar({ activePage, onChange }) {
  return (
    <nav className="admin-nav" aria-label="Admin navigation">
      {NAV_ITEMS.map((item) => (
        <button
          type="button"
          key={item.id}
          className={activePage === item.id ? "nav-pill active" : "nav-pill"}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
