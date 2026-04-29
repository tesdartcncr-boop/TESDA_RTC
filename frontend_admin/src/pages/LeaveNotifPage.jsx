import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";

const EMPTY_LEAVE_TYPE = {
  code: "",
  name: "",
  description: ""
};

function formatQuantity(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return "0";
  }

  if (Number.isInteger(numeric)) {
    return String(numeric);
  }

  return numeric.toFixed(2).replace(/\.00$/, "");
}

function getEmployeeCategoryLabel(category) {
  return String(category || "").toLowerCase() === "jo" ? "Job Order" : "Regular";
}

export default function LeaveNotifPage() {
  const [employees, setEmployees] = useState([]);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [balanceDraft, setBalanceDraft] = useState({});
  const [leaveTypeDraft, setLeaveTypeDraft] = useState(EMPTY_LEAVE_TYPE);
  const [status, setStatus] = useState("Loading leave registry...");
  const [isLoading, setIsLoading] = useState(true);
  const [isLeaveTypeSaving, setIsLeaveTypeSaving] = useState(false);
  const [isBalanceSaving, setIsBalanceSaving] = useState(false);

  async function loadDashboard() {
    setIsLoading(true);
    setStatus("Loading leave registry...");

    try {
      const data = await api.getLeaveNotifDashboard();
      const nextEmployees = Array.isArray(data.employees) ? data.employees : [];
      const nextLeaveTypes = Array.isArray(data.leave_types) ? data.leave_types : [];
      const nextBalances = Array.isArray(data.balances) ? data.balances : [];

      setEmployees(nextEmployees);
      setLeaveTypes(nextLeaveTypes);
      setBalances(nextBalances);
      setStatus("Leave registry ready.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    function handleLeaveInvalidate() {
      loadDashboard();
    }

    function handleEmployeeInvalidate() {
      loadDashboard();
    }

    window.addEventListener("leave-notifs:invalidate", handleLeaveInvalidate);
    window.addEventListener("employees:invalidate", handleEmployeeInvalidate);

    return () => {
      window.removeEventListener("leave-notifs:invalidate", handleLeaveInvalidate);
      window.removeEventListener("employees:invalidate", handleEmployeeInvalidate);
    };
  }, []);

  const activeLeaveTypes = useMemo(() => leaveTypes.filter((leaveType) => leaveType.active), [leaveTypes]);
  const selectedEmployee = useMemo(
    () => employees.find((employee) => String(employee.id) === String(selectedEmployeeId)) || null,
    [employees, selectedEmployeeId]
  );

  const balancesByKey = useMemo(() => {
    const lookup = new Map();
    balances.forEach((row) => {
      lookup.set(`${row.employee_id}:${row.leave_type_id}`, Number(row.quantity ?? 0));
    });
    return lookup;
  }, [balances]);

  const balanceMatrixRows = useMemo(() => {
    return employees.map((employee) => ({
      employee,
      values: activeLeaveTypes.map((leaveType) => balancesByKey.get(`${employee.id}:${leaveType.id}`) ?? 0)
    }));
  }, [employees, activeLeaveTypes, balancesByKey]);

  useEffect(() => {
    if (!employees.length) {
      setSelectedEmployeeId("");
      return;
    }

    setSelectedEmployeeId((currentEmployeeId) => {
      const currentExists = employees.some((employee) => String(employee.id) === String(currentEmployeeId));
      return currentExists ? currentEmployeeId : String(employees[0].id);
    });
  }, [employees]);

  useEffect(() => {
    if (!selectedEmployeeId) {
      setBalanceDraft({});
      return;
    }

    const nextDraft = {};
    activeLeaveTypes.forEach((leaveType) => {
      nextDraft[leaveType.id] = String(balancesByKey.get(`${selectedEmployeeId}:${leaveType.id}`) ?? 0);
    });
    setBalanceDraft(nextDraft);
  }, [selectedEmployeeId, activeLeaveTypes, balancesByKey]);

  function updateLeaveTypeDraft(field, value) {
    setLeaveTypeDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value
    }));
  }

  function updateBalanceDraft(leaveTypeId, value) {
    setBalanceDraft((currentDraft) => ({
      ...currentDraft,
      [leaveTypeId]: value
    }));
  }

  async function handleCreateLeaveType(event) {
    event.preventDefault();

    const code = leaveTypeDraft.code.trim();
    const name = leaveTypeDraft.name.trim();
    const description = leaveTypeDraft.description.trim();

    if (!code || !name) {
      setStatus("Enter a leave type code and name.");
      return;
    }

    setIsLeaveTypeSaving(true);
    setStatus("Saving leave type...");

    try {
      await api.addLeaveType({ code, name, description: description || null });
      setLeaveTypeDraft(EMPTY_LEAVE_TYPE);
      await loadDashboard();
      setStatus(`Leave type ${code.toUpperCase()} saved.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsLeaveTypeSaving(false);
    }
  }

  async function toggleLeaveTypeActive(leaveType) {
    setIsLeaveTypeSaving(true);
    setStatus(leaveType.active ? `Disabling ${leaveType.code}...` : `Restoring ${leaveType.code}...`);

    try {
      await api.updateLeaveType(leaveType.id, { active: !leaveType.active });
      await loadDashboard();
      setStatus(`${leaveType.code} ${leaveType.active ? "disabled" : "restored"}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsLeaveTypeSaving(false);
    }
  }

  async function saveEmployeeBalances(event) {
    event.preventDefault();

    if (!selectedEmployee) {
      setStatus("Select an employee first.");
      return;
    }

    if (!activeLeaveTypes.length) {
      setStatus("Add at least one active leave type before assigning balances.");
      return;
    }

    setIsBalanceSaving(true);
    setStatus(`Saving leave balances for ${selectedEmployee.name}...`);

    try {
      await api.saveEmployeeLeaveBalances({
        employee_id: selectedEmployee.id,
        balances: activeLeaveTypes.map((leaveType) => ({
          leave_type_id: leaveType.id,
          quantity: Number(balanceDraft[leaveType.id] ?? 0) || 0
        }))
      });

      await loadDashboard();
      setStatus(`Saved leave balances for ${selectedEmployee.name}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsBalanceSaving(false);
    }
  }

  return (
    <section className="card leave-notif-page">
      <header className="leave-notif-page__header">
        <div>
          <p className="section-kicker">Leave Notif</p>
          <h2>Leave registry and employee balances</h2>
          <p className="subtle">Add leave types, assign quantities per employee, and keep the user profile popup in sync.</p>
        </div>
        <div className="leave-notif-page__meta">
          <div className="status-pill status-pill--live">{activeLeaveTypes.length} active leave types</div>
          <p className="subtle">Status: {status}</p>
        </div>
      </header>

      <div className="leave-notif-grid">
        <article className="card leave-notif-panel">
          <div>
            <p className="section-kicker">Leave types</p>
            <h3>Register what employees can see</h3>
            <p className="subtle">Only active leave types appear in the employee profile popup.</p>
          </div>

          <form className="leave-notif-card__form" onSubmit={handleCreateLeaveType}>
            <div className="leave-notif-form-grid">
              <label>
                Code
                <input
                  type="text"
                  placeholder="SL"
                  value={leaveTypeDraft.code}
                  onChange={(event) => updateLeaveTypeDraft("code", event.target.value)}
                />
              </label>
              <label>
                Name
                <input
                  type="text"
                  placeholder="Sick Leave"
                  value={leaveTypeDraft.name}
                  onChange={(event) => updateLeaveTypeDraft("name", event.target.value)}
                />
              </label>
              <label className="leave-notif-form-grid__wide">
                Description
                <input
                  type="text"
                  placeholder="Leave credit for illness or recovery"
                  value={leaveTypeDraft.description}
                  onChange={(event) => updateLeaveTypeDraft("description", event.target.value)}
                />
              </label>
            </div>

            <button type="submit" disabled={isLeaveTypeSaving}>
              {isLeaveTypeSaving ? "Saving..." : "Add leave type"}
            </button>
          </form>

          <div className="leave-notif-type-list">
            {leaveTypes.length ? leaveTypes.map((leaveType) => (
              <article key={leaveType.id} className="leave-notif-type-row">
                <div className="leave-notif-type-row__meta">
                  <strong>{leaveType.code}</strong>
                  <span>{leaveType.name}</span>
                  {leaveType.description ? <p className="subtle">{leaveType.description}</p> : null}
                </div>

                <div className="leave-notif-type-row__actions">
                  <span className={leaveType.active ? "status-pill status-pill--live" : "status-pill"}>
                    {leaveType.active ? "Active" : "Inactive"}
                  </span>
                  <button
                    type="button"
                    className={leaveType.active ? "danger" : ""}
                    onClick={() => toggleLeaveTypeActive(leaveType)}
                    disabled={isLeaveTypeSaving}
                  >
                    {leaveType.active ? "Disable" : "Restore"}
                  </button>
                </div>
              </article>
            )) : <p className="subtle">No leave types configured yet.</p>}
          </div>
        </article>

        <article className="card leave-notif-panel">
          <div>
            <p className="section-kicker">Employee balances</p>
            <h3>Set quantities per employee</h3>
            <p className="subtle">Pick a name, then save the leave quantities that should appear in the profile popup.</p>
          </div>

          <form className="leave-notif-card__form" onSubmit={saveEmployeeBalances}>
            <div className="toolbar leave-notif-toolbar">
              <label className="leave-notif-employee-field">
                Employee
                <select value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}>
                  <option value="">Select employee</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name} • {getEmployeeCategoryLabel(employee.category)}
                    </option>
                  ))}
                </select>
              </label>

              <button type="submit" disabled={isBalanceSaving || !selectedEmployee || !activeLeaveTypes.length || isLoading}>
                {isBalanceSaving ? "Saving..." : "Save balances"}
              </button>
            </div>

            <p className="subtle">
              {selectedEmployee
                ? `Editing balances for ${selectedEmployee.name}${selectedEmployee.office ? ` from ${selectedEmployee.office}` : ""}.`
                : "Pick a name to load and edit their leave quantities."}
            </p>

            <div className="leave-notif-balance-grid">
              {activeLeaveTypes.length ? activeLeaveTypes.map((leaveType) => (
                <label key={leaveType.id} className="leave-notif-balance-field">
                  <span>{leaveType.code} - {leaveType.name}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={balanceDraft[leaveType.id] ?? "0"}
                    onChange={(event) => updateBalanceDraft(leaveType.id, event.target.value)}
                    disabled={!selectedEmployee || isBalanceSaving}
                  />
                </label>
              )) : <p className="subtle">Add an active leave type before assigning balances.</p>}
            </div>
          </form>
        </article>
      </div>

      <article className="card leave-notif-summary-card">
        <div>
          <p className="section-kicker">Preview</p>
          <h3>Current allocation matrix</h3>
          <p className="subtle">This view mirrors what employees will see after they unlock their profile.</p>
        </div>

        <div className="table-container">
          <table className="leave-notif-summary-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Category</th>
                {activeLeaveTypes.map((leaveType) => (
                  <th key={leaveType.id}>{leaveType.code}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {balanceMatrixRows.length ? balanceMatrixRows.map(({ employee, values }) => (
                <tr key={employee.id}>
                  <td>{employee.name}</td>
                  <td>{getEmployeeCategoryLabel(employee.category)}</td>
                  {values.map((value, index) => (
                    <td key={`${employee.id}-${activeLeaveTypes[index]?.id || index}`}>{formatQuantity(value)}</td>
                  ))}
                </tr>
              )) : (
                <tr>
                  <td colSpan={2 + activeLeaveTypes.length}>
                    <p className="subtle">No employee leave balances have been loaded yet.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}