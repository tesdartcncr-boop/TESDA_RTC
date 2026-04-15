import { useEffect, useState } from "react";
import { api } from "../services/api";

function createEmptyNameParts() {
  return {
    firstName: "",
    secondName: "",
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
      secondName: "",
      lastName: "",
      extension
    };
  }

  if (baseTokens.length === 2) {
    return {
      firstName: baseTokens[0],
      secondName: "",
      lastName: baseTokens[1],
      extension
    };
  }

  return {
    firstName: baseTokens[0],
    secondName: baseTokens.slice(1, -1).join(" "),
    lastName: baseTokens[baseTokens.length - 1],
    extension
  };
}

function hydrateEmployeeNameParts(employee) {
  if (employee.first_name || employee.second_name || employee.last_name || employee.extension) {
    return {
      firstName: employee.first_name || "",
      secondName: employee.second_name || "",
      lastName: employee.last_name || "",
      extension: employee.extension || "",
      employeePassword: ""
    };
  }

  return {
    ...splitEmployeeName(employee.name || ""),
    employeePassword: ""
  };
}

function composeEmployeeName(parts) {
  return [parts.firstName, parts.secondName, parts.lastName, parts.extension]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

function buildEmployeePayload(parts, category) {
  const name = composeEmployeeName(parts);

  return {
    first_name: parts.firstName.trim(),
    second_name: parts.secondName.trim() || null,
    last_name: parts.lastName.trim(),
    extension: parts.extension.trim() || null,
    name,
    category,
    employee_password: parts.employeePassword.trim() || null
  };
}

export default function EmployeesPage() {
  const [category, setCategory] = useState("regular");
  const [newNameParts, setNewNameParts] = useState(createEmptyNameParts());
  const [employees, setEmployees] = useState([]);
  const [draftNames, setDraftNames] = useState({});
  const [status, setStatus] = useState("Ready");

  async function loadEmployees() {
    setStatus("Loading employees...");
    try {
      const list = await api.getEmployees(category);
      setEmployees(list);
      setDraftNames(Object.fromEntries(list.map((item) => [item.id, hydrateEmployeeNameParts(item)])));
      setStatus("Ready");
    } catch (error) {
      setStatus(error.message);
    }
  }

  useEffect(() => {
    loadEmployees();
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

  async function addEmployee() {
    if (!newNameParts.firstName.trim() || !newNameParts.lastName.trim()) {
      setStatus("First and last name are required.");
      return;
    }

    if (!newNameParts.employeePassword.trim()) {
      setStatus("Employee password is required.");
      return;
    }

    try {
      await api.createEmployee(buildEmployeePayload(newNameParts, category));
      setNewNameParts(createEmptyNameParts());
      await loadEmployees();
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function saveEmployee(employeeId) {
    const nameParts = draftNames[employeeId] || createEmptyNameParts();

    if (!nameParts.firstName.trim() || !nameParts.lastName.trim()) {
      setStatus("First and last name are required.");
      return;
    }

    try {
      await api.updateEmployee(employeeId, buildEmployeePayload(nameParts, category));
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
    <section className="card">
      <h2>Employee Management</h2>
      <p className="subtle">Status: {status}</p>
      <p className="subtle">Use FN, SN, LN, an optional extension, and assign a password for time in/out.</p>

      <div className="toolbar">
        <div className="tab-cluster">
          <button type="button" className={category === "regular" ? "mini-tab active" : "mini-tab"} onClick={() => setCategory("regular")}>Regular</button>
          <button type="button" className={category === "jo" ? "mini-tab active" : "mini-tab"} onClick={() => setCategory("jo")}>JO</button>
        </div>

        <div className="name-grid">
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
            <span>SN</span>
            <input
              className="name-input"
              placeholder="Second name"
              value={newNameParts.secondName}
              onChange={(event) => setNewNameParts((prev) => ({ ...prev, secondName: event.target.value }))}
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
          <label className="name-field name-field--password">
            <span>Password</span>
            <input
              className="name-input"
              type="password"
              placeholder="Assign employee password"
              value={newNameParts.employeePassword}
              onChange={(event) => setNewNameParts((prev) => ({ ...prev, employeePassword: event.target.value }))}
            />
          </label>
          <button type="button" className="name-submit" onClick={addEmployee}>Add employee</button>
        </div>
      </div>

      <div className="table-container">
        <table className="employee-table">
          <thead>
            <tr>
              <th>FN</th>
              <th>SN</th>
              <th>LN</th>
              <th>Ext.</th>
              <th>Password</th>
              <th>Category</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
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
                    value={draftNames[employee.id]?.secondName || ""}
                    onChange={(event) => updateDraftName(employee.id, "secondName", event.target.value)}
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
                  <input
                    className="name-input"
                    type="password"
                    placeholder="Leave blank to keep"
                    value={draftNames[employee.id]?.employeePassword || ""}
                    onChange={(event) => updateDraftName(employee.id, "employeePassword", event.target.value)}
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
