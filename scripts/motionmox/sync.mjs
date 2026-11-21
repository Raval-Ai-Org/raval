#!/usr/bin/env node
/**
 * Copy the built MotionMox packages Mellox uses from the fork into
 * vendor/motionmox/packages, so the app installs them as `file:` links.
 *
 *   node scripts/motionmox/sync.mjs --root H:\MotionMox [--dry-run]
 *
 * Starts from the packages Mellox imports and follows their @motionmox/*
 * dependencies. Only the published files of each package are copied (its
 * `files` list), with each package.json rewritten so internal dependencies
 * point at the sibling folder. The compositor binary is copied only for the
 * two platforms Mellox runs on (Windows for development, Linux for Docker).
 * Remotion's licence goes into every package and into vendor/motionmox.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOTS = ["core", "renderer", "transitions", "player", "bundler"];
const COMPOSITORS = ["compositor-win32-x64-msvc", "compositor-linux-x64-gnu"];

const args = process.argv.slice(2);
const rootArg = args.includes("--root") ? args[args.indexOf("--root") + 1] : "";
if (!rootArg) {
  console.error("usage: sync.mjs --root <path to the fork> [--dry-run]");
  process.exit(2);
}
const FORK = path.resolve(rootArg);
const DRY = args.includes("--dry-run");
const VENDOR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "vendor",
  "motionmox",
);
const OUT = path.join(VENDOR, "packages");

const dirOf = new Map();
for (const dir of fs.readdirSync(path.join(FORK, "packages"))) {
  const pj = path.join(FORK, "packages", dir, "package.json");
  if (fs.existsSync(pj)) dirOf.set(JSON.parse(fs.readFileSync(pj, "utf8")).name, dir);
}

const internal = (deps = {}) => Object.keys(deps).filter((d) => d.startsWith("@motionmox/"));
const wanted = new Set();
const visit = (dir) => {
  if (wanted.has(dir)) return;
  wanted.add(dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(FORK, "packages", dir, "package.json"), "utf8"));
  // Optional peers (whisper, video matting: onnxruntime, hundreds of MB) are never pulled in.
  const requiredPeers = internal(pkg.peerDependencies).filter(
    (d) => !pkg.peerDependenciesMeta?.[d]?.optional,
  );
  for (const dep of [...internal(pkg.dependencies), ...requiredPeers]) {
    const d = dirOf.get(dep);
    if (!d) throw new Error(`${dir} depends on ${dep}, which isn't in the fork`);
    visit(d);
  }
};
ROOTS.forEach(visit);
COMPOSITORS.forEach((c) => wanted.add(c));

function copy(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    if (path.basename(from) === "node_modules" || path.basename(from) === "test") return 0;
    let n = 0;
    for (const entry of fs.readdirSync(from))
      n += copy(path.join(from, entry), path.join(to, entry));
    return n;
  }
  if (/\.(map|tsbuildinfo)$/.test(from)) return 0;
  if (!DRY) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  return stat.size;
}

function packedFiles(dir) {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: dir,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, npm_config_loglevel: "silent" },
  });
  const [info] = JSON.parse(out.slice(out.indexOf("[")));
  return info.files.map((f) => f.path);
}

// bun's `catalog:` versions live in the fork's root package.json; npm needs the real version.
const rootPkg = JSON.parse(fs.readFileSync(path.join(FORK, "package.json"), "utf8"));
const catalog = rootPkg.catalog ?? rootPkg.workspaces?.catalog ?? {};
function resolveCatalog(name, v) {
  if (typeof v !== "string" || !v.startsWith("catalog:")) return v;
  const found = catalog[name];
  if (!found) throw new Error(`${name} uses ${v}, which the fork's catalog doesn't list`);
  return found;
}

const version = JSON.parse(
  fs.readFileSync(path.join(FORK, "packages", "core", "package.json"), "utf8"),
).version;
let bytes = 0;
if (!DRY) fs.rmSync(OUT, { recursive: true, force: true });
for (const dir of [...wanted].sort()) {
  const src = path.join(FORK, "packages", dir);
  const dst = path.join(OUT, dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
  if (!COMPOSITORS.includes(dir) && !fs.existsSync(path.join(src, "dist")))
    throw new Error(`${dir} has no dist/: build it first (scripts/motionmox/build.mjs)`);
  // Exactly what `npm pack` would publish (files list or .npmignore).
  const files = COMPOSITORS.includes(dir)
    ? fs.readdirSync(src).filter((f) => f !== "package.json")
    : packedFiles(src).filter((f) => f !== "package.json");
  for (const f of files) {
    const from = path.join(src, f);
    if (fs.existsSync(from)) bytes += copy(from, path.join(dst, f));
  }
  const rewrite = (deps) =>
    deps &&
    Object.fromEntries(
      Object.entries(deps)
        .filter(
          ([name]) =>
            !name.startsWith("@motionmox/compositor-") || COMPOSITORS.includes(dirOf.get(name)),
        )
        .filter(([name]) => !name.startsWith("@motionmox/") || wanted.has(dirOf.get(name)))
        .map(([name, v]) => [
          name,
          name.startsWith("@motionmox/") ? `file:../${dirOf.get(name)}` : resolveCatalog(name, v),
        ]),
    );
  const out = {
    ...pkg,
    version,
    private: true,
    license: "SEE LICENSE IN LICENSE.md",
    dependencies: rewrite(pkg.dependencies),
    optionalDependencies: rewrite(pkg.optionalDependencies),
    peerDependencies: pkg.peerDependencies
      ? Object.fromEntries(
          Object.entries(pkg.peerDependencies).filter(([n]) => !n.startsWith("@motionmox/")),
        )
      : undefined,
  };
  delete out.devDependencies;
  delete out.scripts;
  delete out.publishConfig;
  if (!DRY) {
    fs.mkdirSync(dst, { recursive: true });
    fs.writeFileSync(path.join(dst, "package.json"), JSON.stringify(out, null, 2) + "\n");
    fs.copyFileSync(path.join(FORK, "LICENSE.md"), path.join(dst, "LICENSE.md"));
  }
  console.log(`${DRY ? "would copy" : "copied"} ${dir}`);
}
if (!DRY) fs.copyFileSync(path.join(FORK, "LICENSE.md"), path.join(VENDOR, "LICENSE.md"));
console.log(
  `MotionMox ${version}: ${wanted.size} packages, ${(bytes / 1048576).toFixed(1)} MB${DRY ? " (dry run)" : ""}`,
);
