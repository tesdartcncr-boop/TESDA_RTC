const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const backendRoot = path.join(repoRoot, "backend");
const pythonExecutable = process.platform === "win32"
  ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
  : path.join(repoRoot, ".venv", "bin", "python");

const command = fs.existsSync(pythonExecutable) ? pythonExecutable : "python";
const child = spawn(
  command,
  ["-m", "uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"],
  {
    cwd: backendRoot,
    stdio: "inherit",
    env: process.env
  }
);

function shutdown(signal) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(0);
  }

  process.exit(code ?? 0);
});