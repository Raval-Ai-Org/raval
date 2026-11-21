#!/usr/bin/env node
/**
 * Lets `npm run build` work in a local checkout, the way Docker builds do.
 *
 *   node scripts/motionmox/local-build.mjs copy     (prebuild)
 *   node scripts/motionmox/local-build.mjs restore  (postbuild, and before dev)
 *
 * `npm install` links node_modules/@motionmox/* to vendor/motionmox. Through a
 * link, Turbopack sees vendor/... and ignores `serverExternalPackages`, then
 * bundles MotionMox's renderer and bundler into server routes and the build
 * fails. Docker runs materialize.mjs after `npm ci` (real copies, for good).
 * Locally, "copy" does the same but remembers each link, and "restore" puts
 * the links back so the dev server keeps using vendor/ as it is synced.
 * With no links (Docker, CI), both are no-ops.
 */
import fs from "node:fs";
import path from "node:path";

const scope = path.join(process.cwd(), "node_modules", "@motionmox");
const record = path.join(scope, ".local-build-links.json");
const mode = process.argv[2];

if (!fs.existsSync(scope)) process.exit(0);

if (mode === "copy") {
  const links = {};
  for (const name of fs.readdirSync(scope)) {
    const link = path.join(scope, name);
    if (!fs.lstatSync(link).isSymbolicLink()) continue;
    links[name] = fs.realpathSync(link);
  }
  if (!Object.keys(links).length) process.exit(0);
  // Written first: if the copy stops halfway, "restore" still knows every link.
  const before = fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, "utf8")) : {};
  fs.writeFileSync(record, JSON.stringify({ ...before, ...links }, null, 2));
  for (const [name, target] of Object.entries(links)) {
    const link = path.join(scope, name);
    fs.rmSync(link, { force: true, recursive: false });
    fs.cpSync(target, link, { recursive: true, dereference: false, verbatimSymlinks: true });
  }
  console.log(`MotionMox: ${Object.keys(links).length} package(s) copied in for the build.`);
} else if (mode === "restore") {
  if (!fs.existsSync(record)) process.exit(0);
  const links = JSON.parse(fs.readFileSync(record, "utf8"));
  for (const [name, target] of Object.entries(links)) {
    const link = path.join(scope, name);
    if (fs.existsSync(link) && fs.lstatSync(link).isSymbolicLink()) continue;
    if (!fs.existsSync(target)) continue;
    fs.rmSync(link, { force: true, recursive: true });
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  }
  fs.rmSync(record, { force: true });
  console.log(`MotionMox: ${Object.keys(links).length} link(s) to vendor/motionmox restored.`);
} else {
  console.error("usage: local-build.mjs copy|restore");
  process.exit(1);
}
