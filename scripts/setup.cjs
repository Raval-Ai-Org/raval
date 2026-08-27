#!/usr/bin/env node
/**
 * RavalAI — first-time developer setup (cross-platform wrapper)
 * -----------------------------------------------------------------------
 * Detects the OS and runs the right setup script:
 *   - Linux/macOS:  scripts/setup.sh
 *   - Windows:      scripts/setup.ps1
 *
 * Usage:
 *   node scripts/setup.js
 *   npm run setup      (which calls this file)
 *
 * The underlying scripts have the same behavior on every platform.
 * This wrapper exists so `npm run setup` works the same on Ubuntu
 * and Windows PowerShell.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";
const scriptName = isWindows ? "setup.ps1" : "setup.sh";
const scriptPath = path.join(__dirname, scriptName);

if (!fs.existsSync(scriptPath)) {
  console.error(`[setup] Missing script: ${scriptPath}`);
  process.exit(1);
}

let cmd, args;
if (isWindows) {
  // PowerShell script. We use `powershell -ExecutionPolicy Bypass -File ...`
  // Bypass is required because the default Windows policy blocks .ps1 scripts.
  cmd = "powershell";
  args = [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
  ];
} else {
  cmd = "bash";
  args = [scriptPath];
}

const result = spawnSync(cmd, args, {
  cwd: root,
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(`[setup] Failed to run ${cmd}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 0);
