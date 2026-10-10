// Check release changes without making unrelated legacy formatting debt a gate.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const base = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : process.env.GITHUB_REF_NAME === "main" || process.env.GITHUB_REF_NAME === "master"
    ? "HEAD^"
    : "origin/main";

const diff = spawnSync("git", ["diff", "--name-only", "--diff-filter=ACMRT", "-z", base, "--"], {
  encoding: "utf8",
});
if (diff.status !== 0) {
  process.stderr.write(diff.stderr || `Could not compare changed files with ${base}.\n`);
  process.exit(1);
}

const files = diff.stdout.split("\0").filter(Boolean);
if (files.length === 0) {
  console.log("No changed files to format-check.");
  process.exit(0);
}

const prettier = join(process.cwd(), "node_modules", "prettier", "bin", "prettier.cjs");
const result = spawnSync(process.execPath, [prettier, "--check", "--ignore-unknown", ...files], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
