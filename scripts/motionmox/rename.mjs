#!/usr/bin/env node
/**
 * MotionMox rename + Mellox patches.
 *
 * Turns a clean clone of remotion-dev/remotion (4.x) into MotionMox, Mellox's
 * modified fork. Deterministic and safe to re-run: a second run changes
 * nothing. Upgrading is "clone the new tag, run this script, build, sync".
 *
 *   node scripts/motionmox/rename.mjs --root H:\MotionMox [--dry-run]
 *
 * What it renames:
 *   - npm names and imports: `remotion` -> `@motionmox/core`,
 *     `@remotion/*` -> `@motionmox/*`
 *   - the CLI binary `remotion` -> `motionmox`, `npx remotion` in text
 *   - the config file `remotion.config.ts` -> `motionmox.config.ts`
 *   - env vars `REMOTION_*` -> `MOTIONMOX_*`
 *   - the product word "Remotion" in messages and docs -> "MotionMox"
 *
 * What it never touches:
 *   - API names (`useCurrentFrame`, `Composition`, `getRemotionEnvironment`...)
 *     because only whole words and module specifiers are rewritten;
 *   - LICENSE files, and any line that carries a copyright or licence
 *     statement or links to the original project (remotion.dev / remotion.pro
 *     / github.com). Remotion's licence and attribution stay intact.
 *
 * Then it applies the Mellox patches listed in vendor/motionmox/MELLOX_PATCHES.md.
 * A report of every changed file is written to <root>/MOTIONMOX_RENAME_REPORT.txt.
 */
import fs from "node:fs";
import path from "node:path";

let ROOT = "";
let DRY = false;

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".turbo", ".cache", "target"]);
const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".md",
  ".mdx",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
  ".html",
  ".css",
  ".scss",
  ".lock",
  ".sh",
]);
const isLicenceFile = (name) => /^(licen[cs]e|notice|copying)(\.|$)/i.test(name);
/** Lines that state a licence, a copyright or point at the original project keep "Remotion". */
const PROTECTED_LINE =
  /copyright|©|licen[cs]e|remotion\.(dev|pro)|github\.com|discord\.gg|x\.com\/remotion/i;

/** Pure: rename one file's text. Exported for the fixture test. */
export function renameText(text, { isDoc = false, isJson = false, isBuildConfig = false } = {}) {
  let out = text;
  // 1. Scoped packages.
  out = out.replace(/@remotion\//g, "@motionmox/");
  // 2. The core package, only where it is a module name: in JSON (package
  //    names, dependencies, paths) and after import / from / require / mock /
  //    declare module in code. A plain 'remotion' string elsewhere (the
  //    compositor binary, an FFmpeg argument) is left as it is.
  const sub = "((?:\\/[A-Za-z0-9_.\\-*]+)*)";
  if (isJson || isBuildConfig) {
    // In JSON and build configs (bundle.ts `external` lists, bundler aliases)
    // every quoted 'remotion' is the package.
    out = out.replace(
      new RegExp(`(["'])remotion${sub}\\1`, "g"),
      (_m, q, s) => `${q}@motionmox/core${s}${q}`,
    );
  } else {
    out = out.replace(
      new RegExp(
        `(\\b(?:from|import|require|require\\.resolve|resolve|mock|doMock|importActual|requireActual|module)\\s*\\(?\\s*)(['"\`])remotion${sub}\\2`,
        "g",
      ),
      (_m, lead, q, s) => `${lead}${q}@motionmox/core${s}${q}`,
    );
  }
  // 2b. Inside a regex literal (/from 'remotion'/g) the new name's slash must be escaped.
  out = out.replace(
    /(\/[^/\n]*from\s*['"])@motionmox\/([a-z-]+)(['"][^/\n]*\/[dgimsuy]*)/g,
    "$1@motionmox\\/$2$3",
  );
  // 3. Env vars.
  out = out.replace(/\bREMOTION_([A-Z0-9_]+)/g, "MOTIONMOX_$1");
  // 4. Config file name and CLI invocations.
  out = out.replace(/\bremotion\.config\.(ts|js|mjs|cjs)\b/g, "motionmox.config.$1");
  out = out.replace(/\b(npx|bunx|pnpm exec|yarn|bun x) remotion\b/g, "$1 motionmox");
  // 5. The product word, outside protected lines.
  out = out
    .split("\n")
    .map((line) => (PROTECTED_LINE.test(line) ? line : line.replace(/\bRemotion\b/g, "MotionMox")))
    .join("\n");
  void isDoc;
  return out;
}

/** Mellox patches: [relative file, anchor, replacement, marker]. Each must apply exactly once. */
const PATCHES = [
  {
    file: "packages/licensing/src/register-usage-event.ts",
    marker: "MOTIONMOX-PATCH usage-off",
    anchor: "}: InternalRegisterUsageEventOptions): Promise<RegisterUsageEventResponse> => {",
    replace: `}: InternalRegisterUsageEventOptions): Promise<RegisterUsageEventResponse> => {
	// MOTIONMOX-PATCH usage-off: no calls home unless a Company License is in use.
	if (
		typeof process === 'undefined' ||
		process.env?.MOTIONMOX_USAGE_EVENTS !== 'true'
	) {
		throw new Error(
			'MotionMox: usage events are off. Set MOTIONMOX_USAGE_EVENTS=true only with a Company License.',
		);
	}
`,
  },
  {
    file: "packages/licensing/src/get-usage.ts",
    marker: "MOTIONMOX-PATCH usage-off",
    anchor: "} & EitherApiKeyOrLicenseKey): Promise<GetUsageResponse> => {",
    replace: `} & EitherApiKeyOrLicenseKey): Promise<GetUsageResponse> => {
	// MOTIONMOX-PATCH usage-off
	if (
		typeof process === 'undefined' ||
		process.env?.MOTIONMOX_USAGE_EVENTS !== 'true'
	) {
		throw new Error('MotionMox: usage reads are off.');
	}
`,
  },
  {
    file: "packages/renderer/src/ensure-browser.ts",
    marker: "MOTIONMOX-PATCH system-browser",
    anchor: "}): BrowserStatus => {\n\tif (browserExecutable) {",
    replace: `}): BrowserStatus => {
	// MOTIONMOX-PATCH system-browser: prefer the machine's Chromium, never download one when it is set.
	browserExecutable =
		browserExecutable ||
		process.env.MOTIONMOX_BROWSER_EXECUTABLE ||
		process.env.VISUAL_CAPTURE_BROWSER_PATH ||
		null;
	if (browserExecutable) {`,
  },
  {
    file: "packages/renderer/src/get-local-browser-executable.ts",
    marker: "MOTIONMOX-PATCH system-browser",
    anchor: "\tif (browserExecutablePath) {",
    replace: `\t// MOTIONMOX-PATCH system-browser
\tbrowserExecutablePath =
\t\tbrowserExecutablePath ||
\t\tprocess.env.MOTIONMOX_BROWSER_EXECUTABLE ||
\t\tprocess.env.VISUAL_CAPTURE_BROWSER_PATH ||
\t\tnull;
\tif (browserExecutablePath) {`,
  },
  {
    file: "packages/renderer/src/open-browser.ts",
    marker: "MOTIONMOX-PATCH offline",
    anchor: "\t\t\t'--disable-background-networking',",
    replace: `\t\t\t'--disable-background-networking',
\t\t\t// MOTIONMOX-PATCH offline: only loopback hosts resolve, so a render can never reach the internet.
\t\t\tprocess.env.MOTIONMOX_OFFLINE === 'false'
\t\t\t\t? null
\t\t\t\t: '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost , EXCLUDE 127.0.0.1',`,
  },
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const rootArg = args.includes("--root") ? args[args.indexOf("--root") + 1] : "";
  if (!rootArg) {
    console.error("usage: rename.mjs --root <path to the clone> [--dry-run]");
    process.exit(2);
  }
  ROOT = path.resolve(rootArg);
  DRY = args.includes("--dry-run");
  if (!fs.existsSync(path.join(ROOT, "packages", "core", "package.json"))) {
    throw new Error(`${ROOT} does not look like the Remotion/MotionMox monorepo`);
  }
  const report = [];
  let changed = 0;
  for (const file of walk(ROOT)) {
    const name = path.basename(file);
    if (isLicenceFile(name) || name === "MOTIONMOX_RENAME_REPORT.txt") continue;
    const ext = path.extname(name).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;
    const stat = fs.statSync(file);
    if (stat.size > 8 * 1024 * 1024) continue;
    const before = fs.readFileSync(file, "utf8");
    if (before.includes("\u0000")) continue;
    const after = renameText(before, {
      isDoc: ext === ".md" || ext === ".mdx",
      isJson: ext === ".json" || ext === ".jsonc" || ext === ".lock",
      isBuildConfig: /^(bundle|builder|build)\.(ts|mjs|js|cjs)$|\.config\.(ts|mjs|js|cjs)$/.test(
        name,
      ),
    });
    if (after !== before) {
      changed++;
      report.push(`edit ${path.relative(ROOT, file)}`);
      if (!DRY) fs.writeFileSync(file, after);
    }
  }

  // The CLI binary: the generic rule turned the bin key into "@motionmox/core".
  const cliPkgPath = path.join(ROOT, "packages", "cli", "package.json");
  if (fs.existsSync(cliPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(cliPkgPath, "utf8"));
    if (pkg.bin && typeof pkg.bin === "object") {
      const next = {};
      for (const [k, v] of Object.entries(pkg.bin))
        next[k === "@motionmox/core" ? "motionmox" : k.replace(/^remotion/, "motionmox")] = v;
      if (JSON.stringify(next) !== JSON.stringify(pkg.bin)) {
        pkg.bin = next;
        report.push("bin packages/cli/package.json -> motionmox");
        if (!DRY) fs.writeFileSync(cliPkgPath, JSON.stringify(pkg, null, "\t") + "\n");
      }
    }
  }

  // Config files.
  for (const file of walk(ROOT)) {
    const m = /^remotion\.config\.(ts|js|mjs|cjs)$/.exec(path.basename(file));
    if (!m) continue;
    const to = path.join(path.dirname(file), `motionmox.config.${m[1]}`);
    report.push(`move ${path.relative(ROOT, file)} -> ${path.relative(ROOT, to)}`);
    if (!DRY) fs.renameSync(file, to);
  }

  // Mellox patches.
  for (const p of PATCHES) {
    const file = path.join(ROOT, p.file);
    const src = fs.readFileSync(file, "utf8");
    // A Windows checkout has CRLF line endings; match and write in the file's own style.
    const eol = src.includes("\r\n") ? "\r\n" : "\n";
    const anchor = p.anchor.replace(/\n/g, eol);
    const replacement = p.replace.replace(/\n/g, eol);
    if (src.includes(p.marker)) {
      report.push(`patch ${p.file} (already applied)`);
      continue;
    }
    const count = src.split(anchor).length - 1;
    if (count !== 1)
      throw new Error(`patch anchor for ${p.file} found ${count} times; the upstream code changed`);
    report.push(`patch ${p.file} [${p.marker}]`);
    if (!DRY)
      fs.writeFileSync(
        file,
        src.replace(anchor, () => replacement),
      );
  }

  const summary = `MotionMox rename: ${changed} files edited, ${PATCHES.length} patches checked${DRY ? " (dry run)" : ""}`;
  report.unshift(summary);
  if (!DRY)
    fs.writeFileSync(path.join(ROOT, "MOTIONMOX_RENAME_REPORT.txt"), report.join("\n") + "\n");
  console.log(summary);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/motionmox/rename.mjs")) {
  main();
}
