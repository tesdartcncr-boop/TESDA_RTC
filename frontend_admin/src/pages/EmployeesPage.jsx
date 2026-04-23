import { useEffect, useRef, useState } from "react";
import { api } from "../services/api";

function createEmptyNameParts() {
  return {
    employeeNo: "",
    firstName: "",
    middleName: "",
    lastName: "",
    extension: "",
    employeePassword: ""
  };
}

function normalizeSuffixToken(token) {
  return token.toLowerCase().replace(/[.,]/g, "");
}

function isExtensionToken(token) {
  return ["jr", "sr", "ii", "iii", "iv", "v"].includes(normalizeSuffixToken(token));
}

function splitEmployeeName(name) {
  const tokens = name.trim().split(/\s+/).filter(Boolean);

  if (!tokens.length) {
    return createEmptyNameParts();
  }

  let extension = "";
  let baseTokens = tokens;

  if (tokens.length > 1 && isExtensionToken(tokens[tokens.length - 1])) {
    extension = tokens[tokens.length - 1];
    baseTokens = tokens.slice(0, -1);
  }

  if (baseTokens.length === 1) {
    return {
      firstName: baseTokens[0],
      middleName: "",
      lastName: "",
      extension
    };
  }

  if (baseTokens.length === 2) {
    return {
      firstName: baseTokens[0],
      middleName: "",
      lastName: baseTokens[1],
      extension
    };
  }

  return {
    firstName: baseTokens[0],
    middleName: baseTokens.slice(1, -1).join(" "),
    lastName: baseTokens[baseTokens.length - 1],
    extension
  };
}

function hydrateEmployeeNameParts(employee) {
  if (employee.first_name || employee.second_name || employee.last_name || employee.extension) {
    return {
      employeeNo: employee.employee_no || "",
      firstName: employee.first_name || "",
      middleName: employee.second_name || "",
      lastName: employee.last_name || "",
      extension: employee.extension || "",
      employeePassword: ""
    };
  }

  return {
    ...splitEmployeeName(employee.name || ""),
    employeeNo: employee.employee_no || "",
    employeePassword: ""
  };
}

function composeEmployeeName(parts) {
  return [parts.firstName, parts.middleName, parts.lastName, parts.extension]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function buildEmployeePayload(parts, category, office, fallbackPassword = null) {
  const name = composeEmployeeName(parts);
  const employeePassword = parts.employeePassword.trim() || fallbackPassword || null;

  return {
    employee_no: parts.employeeNo.trim() || null,
    office: office.trim() || null,
    first_name: parts.firstName.trim(),
    second_name: parts.middleName.trim() || null,
    last_name: parts.lastName.trim(),
    extension: parts.extension.trim() || null,
    name,
    category,
    employee_password: employeePassword
  };
}

function validateCreatePayload(parts) {
  if (!parts.firstName.trim() || !parts.lastName.trim()) {
    return "First and last name are required.";
  }

  if (parts.employeePassword.trim() && parts.employeePassword.trim().length < 4) {
    return "Employee password must be at least 4 characters.";
  }

  return "";
}

function validateUpdatePayload(parts) {
  if (!parts.firstName.trim() || !parts.lastName.trim()) {
    return "First and last name are required.";
  }

  if (parts.employeePassword.trim() && parts.employeePassword.trim().length < 4) {
    return "Employee password must be at least 4 characters.";
  }

  return "";
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  isVisible,
  onToggle,
  placeholder,
  minLength,
  autoFocus,
  hint,
  id,
  name,
  ariaLabel,
  compact = false
}) {
  const field = (
    <div className="password-input-shell">
      <input
        id={id}
        name={name}
        className="name-input"
        type={isVisible ? "text" : "password"}
        placeholder={placeholder}
        minLength={minLength}
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        aria-label={ariaLabel || label}
      />
      <button
        type="button"
        className="password-toggle--icon"
        onClick={onToggle}
        aria-pressed={isVisible}
        aria-label={isVisible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
      >
        <EyeIcon />
      </button>
    </div>
  );

  if (compact) {
    return field;
  }

  return (
    <label className="name-field name-field--password">
      <span>{label}</span>
      {hint ? <p className="field-hint">{hint}</p> : null}
      {field}
    </label>
  );
}

export default function EmployeesPage() {
  const [category, setCategory] = useState("regular");
  const [districtOffice, setDistrictOffice] = useState("");
  const [newNameParts, setNewNameParts] = useState(createEmptyNameParts());
  const [employees, setEmployees] = useState([]);
  const [draftNames, setDraftNames] = useState({});
  const [visiblePasswords, setVisiblePasswords] = useState({ new: false });
  const [status, setStatus] = useState("Ready");
  const hasLoadedDistrictOfficeRef = useRef(false);

  async function loadEmployees() {
    setStatus("Loading employees...");
    try {
      const list = await api.getEmployees(category);
      setEmployees(list);
      if (!hasLoadedDistrictOfficeRef.current) {
        const sharedOffice = list.find((item) => (item.office || "").trim())?.office || "";
        setDistrictOffice(sharedOffice);
        hasLoadedDistrictOfficeRef.current = true;
      }
      setDraftNames(Object.fromEntries(list.map((item) => [item.id, hydrateEmployeeNameParts(item)])));
      setStatus("Ready");
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => {
    loadEmployees();
  }, [category]);

  useEffect(() => {
    function handleEmployeesInvalidate() {
      loadEmployees();
    }

    window.addEventListener("employees:invalidate", handleEmployeesInvalidate);
    return () => window.removeEventListener("employees:invalidate", handleEmployeesInvalidate);
  }, [category]);

  function updateDraftName(employeeId, field, value) {
    setDraftNames((prev) => ({
      ...prev,
      [employeeId]: {
        ...(prev[employeeId] || createEmptyNameParts()),
        [field]: value
      }
    }));
  }

  function togglePasswordVisibility(key) {
    setVisiblePasswords((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  }

  async function applyDistrictOffice() {
    try {
      await api.updateDistrictOffice({ office: districtOffice });
      setStatus(districtOffice.trim() ? "District Office applied to all employees" : "District Office cleared for all employees");
      await loadEmployees();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function addEmployee() {
    const validationError = validateCreatePayload(newNameParts);
    if (validationError) {
      setStatus(validationError);
      return;
    }

    try {
      await api.createEmployee(buildEmployeePayload(newNameParts, category, districtOffice, "1234"));
      setNewNameParts(createEmptyNameParts());
      await loadEmployees();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function saveEmployee(employeeId) {
    const nameParts = draftNames[employeeId] || createEmptyNameParts();

    const validationError = validateUpdatePayload(nameParts);
    if (validationError) {
      setStatus(validationError);
      return;
    }

    try {
      await api.updateEmployee(employeeId, buildEmployeePayload(nameParts, category, districtOffice));
      setStatus("Employee saved");
      await loadEmployees();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function removeEmployee(employeeId) {
    try {
      await api.deleteEmployee(employeeId);
      setStatus("Employee removed");
      await loadEmployees();
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <section className="card employee-management-card">
      <h2>Employee Management</h2>
      <p className="subtle">Status: {status}</p>
      <p className="subtle">Use the shared district office field once, then add employee no., FN, MN, LN, an optional extension, and a password for time in/out.</p>

      <div className="employee-management-toolbar">
        <div className="employee-management-tabs-row">
          <p className="section-kicker">Employee type</p>
          <div className="tab-cluster employee-management-tabs">
            <button type="button" className={category === "regular" ? "mini-tab active" : "mini-tab"} onClick={() => setCategory("regular")}>Regular</button>
            <button type="button" className={category === "jo" ? "mini-tab active" : "mini-tab"} onClick={() => setCategory("jo")}>Job Order</button>
          </div>
        </div>

        <div className="employee-management-form-shell">
          <div className="employee-management-district-office-row">
            <label className="name-field employee-management-district-office-field">
              <span>District Office</span>
              <input
                className="name-input"
                placeholder="Used for all employees"
                value={districtOffice}
                onChange={(event) => setDistrictOffice(event.target.value)}
              />
            </label>
            <button type="button" className="name-submit name-submit--inline" onClick={applyDistrictOffice}>
              Apply to all employees
            </button>
          </div>
          <div className="employee-management-number-row">
            <label className="name-field employee-management-number-field">
              <span>Employee No.</span>
              <input
                className="name-input"
                placeholder="Optional"
                value={newNameParts.employeeNo}
                onChange={(event) => setNewNameParts((prev) => ({ ...prev, employeeNo: event.target.value }))}
              />
            </label>
          </div>
          <div className="name-grid employee-management-form">
            <label className="name-field">
              <span>FN</span>
              <input
                className="name-input"
                placeholder="First name"
                value={newNameParts.firstName}
                onChange={(event) => setNewNameParts((prev) => ({ ...prev, firstName: event.target.value }))}
              />
            </label>
            <label className="name-field">
              <span>MN</span>
              <input
                className="name-input"
                placeholder="Middle name"
                value={newNameParts.middleName}
                onChange={(event) => setNewNameParts((prev) => ({ ...prev, middleName: event.target.value }))}
              />
            </label>
            <label className="name-field">
              <span>LN</span>
              <input
                className="name-input"
                placeholder="Last name"
                value={newNameParts.lastName}
                onChange={(event) => setNewNameParts((prev) => ({ ...prev, lastName: event.target.value }))}
              />
            </label>
            <label className="name-field name-field--extension">
              <span>Extension</span>
              <input
                className="name-input"
                placeholder="Optional"
                value={newNameParts.extension}
                onChange={(event) => setNewNameParts((prev) => ({ ...prev, extension: event.target.value }))}
              />
            </label>
            <PasswordField
              label="Password"
              hint="Leave blank to use 1234. Otherwise, use at least 4 characters."
              value={newNameParts.employeePassword}
              onChange={(event) => setNewNameParts((prev) => ({ ...prev, employeePassword: event.target.value }))}
              isVisible={Boolean(visiblePasswords.new)}
              onToggle={() => togglePasswordVisibility("new")}
              placeholder="Assign employee password"
              minLength={4}
              name="new-employee-password"
              ariaLabel="New employee password"
            />
            <button type="button" className="name-submit name-submit--inline" onClick={addEmployee}>Add employee</button>
          </div>
        </div>
      </div>

      <div className="table-container">
        <table key={category} className="employee-table">
          <thead>
            <tr>
              <th>Employee No.</th>
              <th>FN</th>
              <th>MN</th>
              <th>LN</th>
              <th>Ext.</th>
              <th>Password</th>
              <th>Category</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee, index) => (
              <tr key={employee.id} style={{ "--row-index": index }}>
                <td>
                  <input
                    className="name-input"
                    value={draftNames[employee.id]?.employeeNo || ""}
                    onChange={(event) => updateDraftName(employee.id, "employeeNo", event.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="name-input"
                    value={draftNames[employee.id]?.firstName || ""}
                    onChange={(event) => updateDraftName(employee.id, "firstName", event.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="name-input"
                    value={draftNames[employee.id]?.middleName || ""}
                    onChange={(event) => updateDraftName(employee.id, "middleName", event.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="name-input"
                    value={draftNames[employee.id]?.lastName || ""}
                    onChange={(event) => updateDraftName(employee.id, "lastName", event.target.value)}
                  />
                </td>
                <td>
                  <input
                    className="name-input"
                    value={draftNames[employee.id]?.extension || ""}
                    onChange={(event) => updateDraftName(employee.id, "extension", event.target.value)}
                  />
                </td>
                <td>
                  <PasswordField
                    compact
                    label="Password"
                    value={draftNames[employee.id]?.employeePassword || ""}
                    onChange={(event) => updateDraftName(employee.id, "employeePassword", event.target.value)}
                    isVisible={Boolean(visiblePasswords[employee.id])}
                    onToggle={() => togglePasswordVisibility(employee.id)}
                    placeholder="Leave blank to keep"
                    minLength={4}
                    name={`employee-password-${employee.id}`}
                    ariaLabel={`Password for ${employee.name}`}
                  />
                </td>
                <td>{employee.category}</td>
                <td className="actions-cell">
                  <button type="button" onClick={() => saveEmployee(employee.id)}>Save</button>
                  <button type="button" className="danger" onClick={() => removeEmployee(employee.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
