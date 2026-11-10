#!/usr/bin/env node
/**
 * Build the MotionMox packages Mellox uses, inside the fork, with the fork's
 * own toolchain (bun + turbo). Temp files and caches go next to the fork, so
 * a full system drive doesn't break the build.
 *
 *   node scripts/motionmox/build.mjs --root H:\MotionMox [--bun <path to bun>]
 *
 * Needs bun >= 1.4.3 (the fork's `engines`). On the dev machine it lives at
 * H:\tools\node_modules\.bin\bun (npm install --prefix H:\tools bun).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : "");
const FORK = path.resolve(opt("--root") || "");
if (!opt("--root") || !fs.existsSync(path.join(FORK, "turbo.json"))) {
  console.error("usage: build.mjs --root <path to the fork> [--bun <bun>]");
  process.exit(2);
}
const drive = path.parse(FORK).root;
const tmp = path.join(drive, "tmp");
fs.mkdirSync(tmp, { recursive: true });
const bun =
  opt("--bun") ||
  path.join(
    drive,
    "tools",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "bun.cmd" : "bun",
  );
const env = {
  ...process.env,
  TMP: tmp,
  TEMP: tmp,
  BUN_TMPDIR: tmp,
  BUN_INSTALL_CACHE_DIR: path.join(drive, "bun-cache"),
  TURBO_TELEMETRY_DISABLED: "1",
  DO_NOT_TRACK: "1",
  PATH: `${path.dirname(bun)}${path.delimiter}${process.env.PATH}`,
};
const run = (cmd, argv) =>
  execFileSync(cmd, argv, {
    cwd: FORK,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

if (!fs.existsSync(path.join(FORK, "node_modules", ".bun")))
  run(bun, ["install", "--ignore-scripts"]);
const filters = ["renderer", "bundler", "transitions", "player"].map(
  (p) => `--filter=@motionmox/${p}...`,
);
run(path.join(FORK, "node_modules", ".bin", "turbo"), [
  "run",
  "make",
  ...filters,
  "--concurrency=2",
  "--no-update-notifier",
  "--output-logs=errors-only",
]);
console.log("MotionMox built. Next: node scripts/motionmox/sync.mjs --root", FORK);
