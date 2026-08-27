#!/usr/bin/env node
/**
 * RavalAI — predev sanity check (cross-platform wrapper)
 * -----------------------------------------------------------------------
 * Detects the OS and runs the right predev check script:
 *   - Linux/macOS:  scripts/predev-check.sh
 *   - Windows:      scripts/predev-check.ps1
 *
 * Usage:
 *   node scripts/predev-check.js
 *   npm run dev      (which auto-runs this via the "predev" npm script)
 *
 * Always exits 0 so it never blocks `npm run dev` — warnings are advisory.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");
const isWindows = process.platform === "win32";
const scriptName = isWindows ? "predev-check.ps1" : "predev-check.sh";
const scriptPath = path.join(__dirname, scriptName);

if (!fs.existsSync(scriptPath)) {
  // No predev script found — that's fine, just allow dev to start.
  process.exit(0);
}

let cmd, args;
if (isWindows) {
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

// Always exit 0 — predev check is advisory, never blocks the dev server.
process.exit(0);
