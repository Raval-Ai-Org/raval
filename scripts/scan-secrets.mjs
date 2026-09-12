#!/usr/bin/env node
// scan-secrets.mjs — fail CI when a credential-shaped value is committed.
//
//   node scripts/scan-secrets.mjs            scan every git-tracked file
//   node scripts/scan-secrets.mjs --staged   scan only staged files (pre-commit)
//
// Prints file:line and the rule name — NEVER the matched value. Exit 1 on any
// hit. False positives: put `secret-scan:allow` on the same line, with a reason.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const RULES = [
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "openrouter-key", re: /\bsk-or-v1-[a-f0-9]{32,}\b/i },
  { id: "anthropic-key", re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{20,}/ },
  { id: "openai-key", re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/ },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  // A Supabase service-role JWT (role claim inside the base64 payload).
  {
    id: "supabase-service-jwt",
    re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{10,}/,
  },
  { id: "supabase-secret-key", re: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/ },
  // Fernet keys: 43 base64url chars + "=".
  { id: "fernet-key", re: /\b(?:FERNET_KEY|fernet_key)\s*[:=]\s*["']?[A-Za-z0-9_-]{43}=/ },
  // NAME=long-random-value for password/secret/token-named variables.
  {
    id: "assigned-secret",
    re: /\b[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*[:=]\s*["']?(?=[A-Za-z0-9+/_!#%.-]*\d)(?=[A-Za-z0-9+/_!#%.-]*[A-Za-z])[A-Za-z0-9+/_!#%.-]{20,}/,
  },
  {
    id: "postgres-url-password",
    re: /postgres(?:ql)?(?:\+\w+)?:\/\/[^:\s/]+:(?!\$\{|<|\*{3})[^@\s]{8,}@/,
  },
];

// Documented placeholders that look like assignments but are not secrets.
const PLACEHOLDER =
  /(?:change[-_]?(?:me|in[-_]production)|replace[-_]?me|your[-_]|example|placeholder|dummy|test[-_]|fake|xxxx|\*{3}|<[^>]+>|\$\{)/i;

const SKIP = [
  /^node_modules\//,
  /^\.next/,
  /package-lock\.json$/,
  /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|mp4|zip)$/i,
  /^supabase\/baseline\/schema\.sql$/,
];

const staged = process.argv.includes("--staged");
const files = execFileSync(
  "git",
  staged ? ["diff", "--cached", "--name-only", "--diff-filter=ACM"] : ["ls-files"],
  {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
)
  .split("\n")
  .map((f) => f.trim())
  .filter((f) => f && !SKIP.some((re) => re.test(f)));

let hits = 0;
for (const file of files) {
  let text;
  try {
    if (statSync(file).size > 2 * 1024 * 1024) continue;
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (line.includes("secret-scan:allow")) return;
    for (const rule of RULES) {
      const m = rule.re.exec(line);
      if (!m) continue;
      if (rule.id === "assigned-secret" && PLACEHOLDER.test(m[0])) continue;
      if (rule.id === "openai-key" && /sk-or-/.test(line)) continue;
      hits++;
      console.error(`✗ ${file}:${i + 1}  ${rule.id}`);
      break;
    }
  });
}

if (hits) {
  console.error(
    `\n${hits} possible secret(s). Remove them (and rotate anything real), or mark a false positive with "secret-scan:allow".`,
  );
  process.exit(1);
}
console.log(`✓ no secrets found in ${files.length} tracked files`);
