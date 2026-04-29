const NAV_ITEMS = [
  { id: "employees", label: "Employees" },
  { id: "master", label: "Master Sheet" },
  { id: "schedule", label: "Weekly Schedule" },
  { id: "authEmails", label: "Authorized Emails" },
  { id: "leaveNotifs", label: "Leave Notif" },
  { id: "reports", label: "Reports" }
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
