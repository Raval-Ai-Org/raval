#!/usr/bin/env node
/**
 * Replace the node_modules/@motionmox/* links that `npm ci` makes for the
 * file: packages in vendor/motionmox with real copies.
 *
 *   node scripts/motionmox/materialize.mjs
 *
 * Next only honours `serverExternalPackages` for files whose real path is
 * inside node_modules. Through a link, Turbopack sees vendor/motionmox/... and
 * bundles the renderer and bundler (esbuild binaries, React contexts) into
 * server routes, which fails the build. Run in Docker right after `npm ci`.
 */
import fs from "node:fs";
import path from "node:path";

const scope = path.join(process.cwd(), "node_modules", "@motionmox");
if (!fs.existsSync(scope)) {
  console.log("No node_modules/@motionmox; nothing to do.");
  process.exit(0);
}

let copied = 0;
for (const name of fs.readdirSync(scope)) {
  const link = path.join(scope, name);
  if (!fs.lstatSync(link).isSymbolicLink()) continue;
  const target = fs.realpathSync(link);
  fs.rmSync(link, { force: true, recursive: false });
  fs.cpSync(target, link, { recursive: true, dereference: false, verbatimSymlinks: true });
  copied++;
}
console.log(`MotionMox: ${copied} linked package(s) copied into node_modules/@motionmox.`);
