export default function EmployeeTabs({ activeCategory, onChange }) {
  return (
    <div className="tab-row" role="tablist" aria-label="Employee categories">
      <button
        type="button"
        role="tab"
        aria-selected={activeCategory === "regular"}
        className={activeCategory === "regular" ? "tab active" : "tab"}
        onClick={() => onChange("regular")}
      >
        <span className="tab-label">Regular</span>
        <span className="tab-note">Permanent roster</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeCategory === "jo"}
        className={activeCategory === "jo" ? "tab active" : "tab"}
        onClick={() => onChange("jo")}
      >
        <span className="tab-label">Job Order</span>
        <span className="tab-note">Job Order roster</span>
      </button>
    </div>
  );
}
