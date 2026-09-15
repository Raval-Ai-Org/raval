// validate.ts — checks a proposed repository change must pass before a user
// can approve it. Static only: nothing proposed is ever executed.
//
//   paths        every path is one Mellox may write (paths.ts)
//   size         bounded file size and changed-line count
//   changed      the proposal really changes something
//   secrets      no credential-shaped strings added
//   safety       no new scripts, network calls, eval or imports outside an allowlist
//   syntax       JSON / XML well-formed; JS/TS (and <script> blocks) parse
//   rule         the finding's rule re-evaluated against the proposed file, when
//                the file is what the crawler reads (static HTML, robots, llms,
//                sitemap). Framework source is confirmed by the post-merge rescan.
import "server-only";
import { diffLines } from "diff";
import ts from "typescript";
import { analyzePage } from "@/lib/geo/analyze-page";
import type { ProposalValidation, ValidationCheck } from "@/lib/geo/fix-contracts";
import { robotsSitemaps } from "@/lib/geo/robots";
import { scoreScan } from "@/lib/geo/score";
import { looksLikeLlmsTxt, parseSitemap } from "@/lib/geo/sitemap";
import type { CrawledPage, SiteArtifacts } from "@/lib/geo/types";
import { checkRepoPath, MAX_WRITE_BYTES } from "@/server/connectors/github/paths";
import type { FixKind } from "./targets";

export type ProposedFile = {
  path: string;
  action: "create" | "update";
  before: string | null;
  after: string;
};

const MAX_CHANGED_LINES = 400;

export const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{36,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /\bsk-(ant-|proj-|or-)?[A-Za-z0-9_-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
];

const UNSAFE_ADDITIONS: [RegExp, string][] = [
  [/\beval\s*\(/, "eval()"],
  [/new\s+Function\s*\(/, "new Function()"],
  [/document\.write/, "document.write"],
  [/child_process|\bexecSync\b|\bspawn\s*\(/, "process execution"],
  [/process\.env/, "environment access"],
  [/<iframe\b/i, "an iframe"],
  [/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket/, "a network call"],
  [/\bimport\s*\(|\brequire\s*\(/, "a dynamic import"],
  [/<script\b[^>]*\bsrc\s*=/i, "an external script"],
  [/<script\b(?![^>]*application\/ld\+json)[^>]*>/i, "an inline script that isn't JSON-LD"],
  [/\bon(click|load|error|mouseover)\s*=/i, "an inline event handler"],
  [/javascript:/i, "a javascript: URL"],
];

const IMPORT_ALLOWLIST = new Set([
  "next",
  "next/head",
  "next/document",
  "next/script",
  "vue",
  "#app",
  "#imports",
  "@unhead/vue",
  "astro",
]);

function ext(path: string) {
  return path.split(".").pop()!.toLowerCase();
}

export function changedLines(
  before: string,
  after: string,
): { added: string[]; additions: number; deletions: number } {
  const added: string[] = [];
  let additions = 0;
  let deletions = 0;
  for (const part of diffLines(before, after)) {
    const lines = part.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    if (part.added) {
      additions += lines.length;
      added.push(...lines);
    } else if (part.removed) {
      deletions += lines.length;
    }
  }
  return { added, additions, deletions };
}

function parseDiagnostics(text: string, kind: ts.ScriptKind, fileName: string): string | null {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind);
  const diags =
    (sf as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
  if (!diags.length) return null;
  const d = diags[0];
  const { line } = sf.getLineAndCharacterOfPosition(d.start);
  return `line ${line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
}

/** Tag balance for XML documents (sitemaps). */
function xmlProblem(text: string): string | null {
  const stack: string[] = [];
  const body = text.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^>]*?(\/?)>/g)) {
    const [, close, name, selfClose] = m;
    if (selfClose) continue;
    if (close) {
      if (stack.pop() !== name) return `Unexpected </${name}>`;
    } else stack.push(name);
  }
  return stack.length ? `Unclosed <${stack[stack.length - 1]}>` : null;
}

export function syntaxProblem(path: string, text: string): string | null {
  const e = ext(path);
  switch (e) {
    case "json":
      try {
        JSON.parse(text);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : "Invalid JSON";
      }
    case "xml":
      return xmlProblem(text);
    case "ts":
      return parseDiagnostics(text, ts.ScriptKind.TS, path);
    case "tsx":
      return parseDiagnostics(text, ts.ScriptKind.TSX, path);
    case "js":
    case "mjs":
      return parseDiagnostics(text, ts.ScriptKind.JS, path);
    case "jsx":
      return parseDiagnostics(text, ts.ScriptKind.JSX, path);
    case "vue":
    case "svelte": {
      for (const m of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/application\/ld\+json/i.test(m[1])) continue;
        const problem = parseDiagnostics(
          m[2],
          /lang=["']ts["']/i.test(m[1]) ? ts.ScriptKind.TS : ts.ScriptKind.JS,
          path,
        );
        if (problem) return `<script>: ${problem}`;
      }
      return null;
    }
    case "astro": {
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      return fm ? parseDiagnostics(fm[1], ts.ScriptKind.TS, path) : null;
    }
    default:
      return null;
  }
}

function syntheticPage(url: string, html: string): CrawledPage {
  return {
    url,
    finalUrl: url,
    depth: 0,
    state: "fetched",
    statusCode: 200,
    contentType: "text/html",
    fetchMs: null,
    skipReason: null,
    xRobotsTag: null,
    analysis: analyzePage(html, url, { bytes: Buffer.byteLength(html), truncated: false }),
  };
}

function ruleStatusFor(ruleId: string, site: SiteArtifacts, pages: CrawledPage[]) {
  const { report } = scoreScan(site, pages, { mode: "quick" });
  for (const c of report.categories) {
    const r = c.rules.find((x) => x.ruleId === ruleId);
    if (r) return r;
  }
  return null;
}

function ruleRecheck(input: {
  kind: FixKind | null;
  ruleId: string;
  pageUrl: string | null;
  site: SiteArtifacts;
  files: ProposedFile[];
  crawlerReadsFile: boolean;
}): ValidationCheck {
  const base = { id: "rule", label: "Finding re-checked against the proposed file" };
  if (!input.crawlerReadsFile) {
    return {
      ...base,
      status: "skipped",
      detail:
        "This file is framework source, not what crawlers download. The rescan after the pull request is merged and deployed confirms the fix.",
    };
  }
  const file = input.files[0];
  let site: SiteArtifacts = input.site;
  let pages: CrawledPage[] = [];
  if (input.kind === "robots" || input.kind === "robots-sitemap") {
    site = {
      ...site,
      robots: { status: "found", text: file.after, sitemaps: robotsSitemaps(file.after) },
    };
  } else if (input.kind === "llms") {
    site = {
      ...site,
      llms: {
        found: looksLikeLlmsTxt(file.after, "text/plain"),
        bytes: file.after.length,
        full: false,
      },
    };
  } else if (input.kind === "sitemap") {
    const parsed = parseSitemap(file.after);
    site = {
      ...site,
      sitemap: {
        found: parsed.kind !== "invalid" && parsed.locs.length > 0,
        urls: parsed.locs.length,
        isIndex: parsed.kind === "index",
        sources: [`${site.origin}/sitemap.xml`],
      },
    };
  } else {
    const url = input.pageUrl ?? `${site.origin}/`;
    pages = [syntheticPage(url, file.after)];
  }
  const summary = ruleStatusFor(input.ruleId, site, pages);
  if (!summary)
    return {
      ...base,
      status: "fail",
      detail: "The rule couldn't be evaluated on the proposed file.",
    };
  if (summary.status === "pass")
    return { ...base, status: "pass", detail: `Passes: ${summary.detail}` };
  if (summary.status === "na")
    return { ...base, status: "pass", detail: `No longer applies: ${summary.detail}` };
  return { ...base, status: "fail", detail: `Would still ${summary.status}: ${summary.detail}` };
}

export function validateProposal(input: {
  /** The deterministic fix kind, when the rule has one (agent patches may have none). */
  kind: FixKind | null;
  ruleId: string;
  pageUrl: string | null;
  site: SiteArtifacts;
  files: ProposedFile[];
  /** True when the crawler downloads this exact file (static HTML, discovery files). */
  crawlerReadsFile: boolean;
  /** Changed-line cap; a "Fix all" batch reviews more lines in one pull request. */
  maxChangedLines?: number;
  /** Extra imports a patch may add (framework head helpers the repository depends on). */
  allowedImports?: Set<string>;
  /** Whether a relative/alias import resolves to a file in the repository. */
  resolveImport?: (spec: string, fromPath: string) => boolean;
}): ProposalValidation {
  const maxLines = input.maxChangedLines ?? MAX_CHANGED_LINES;
  const checks: ValidationCheck[] = [];
  const add = (c: ValidationCheck) => checks.push(c);

  const pathProblems = input.files
    .map((f) => ({ f, check: checkRepoPath(f.path) }))
    .filter((x) => !x.check.ok)
    .map((x) => `${x.f.path}: ${(x.check as { reason: string }).reason}`);
  add({
    id: "paths",
    label: "Only site source files are changed",
    status: pathProblems.length ? "fail" : "pass",
    detail: pathProblems.length
      ? pathProblems.join("; ")
      : input.files.map((f) => f.path).join(", "),
  });

  let totalChanged = 0;
  const added: { path: string; lines: string[] }[] = [];
  let unchanged = 0;
  let oversize: string | null = null;
  for (const f of input.files) {
    if (Buffer.byteLength(f.after, "utf8") > MAX_WRITE_BYTES) oversize = f.path;
    if (f.before !== null && f.before === f.after) unchanged++;
    const c = changedLines(f.before ?? "", f.after);
    totalChanged += c.additions + c.deletions;
    added.push({ path: f.path, lines: c.added });
  }
  add({
    id: "size",
    label: "The change is small and reviewable",
    status: oversize || totalChanged > maxLines ? "fail" : "pass",
    detail: oversize
      ? `${oversize} would exceed ${Math.round(MAX_WRITE_BYTES / 1000)} KB`
      : `${totalChanged} changed line(s)${totalChanged > maxLines ? ` — over the ${maxLines}-line limit` : ""}`,
  });
  add({
    id: "changed",
    label: "The proposal changes something",
    status: unchanged === input.files.length ? "fail" : "pass",
    detail:
      unchanged === input.files.length
        ? "The proposed files are identical to the current ones."
        : `${input.files.length - unchanged} file(s) change`,
  });

  const secretHits = added.filter((a) =>
    a.lines.some((l) => SECRET_PATTERNS.some((re) => re.test(l))),
  );
  add({
    id: "secrets",
    label: "No credentials added",
    status: secretHits.length ? "fail" : "pass",
    detail: secretHits.length
      ? `Credential-like text in ${secretHits.map((h) => h.path).join(", ")}`
      : "No credential-like strings in added lines",
  });

  const unsafe: string[] = [];
  for (const a of added) {
    const code = !["txt", "xml", "md"].includes(ext(a.path));
    if (!code) continue;
    const text = a.lines.join("\n");
    for (const [re, what] of UNSAFE_ADDITIONS)
      if (re.test(text)) unsafe.push(`${a.path} adds ${what}`);
    if (/dangerouslySetInnerHTML/.test(text) && !/JSON\.stringify/.test(text)) {
      unsafe.push(`${a.path} adds raw HTML injection`);
    }
    for (const m of text.matchAll(
      /^\s*import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gm,
    )) {
      const spec = m[1];
      if (IMPORT_ALLOWLIST.has(spec) || input.allowedImports?.has(spec)) continue;
      // Project-local modules are fine when they really exist in the repository.
      if (/^(\.|@\/|~\/)/.test(spec) && input.resolveImport?.(spec, a.path)) continue;
      unsafe.push(`${a.path} imports “${spec}”`);
    }
  }
  add({
    id: "safety",
    label: "No scripts, network calls or new dependencies",
    status: unsafe.length ? "fail" : "pass",
    detail: unsafe.length
      ? [...new Set(unsafe)].join("; ")
      : "Added lines contain markup and metadata only",
  });

  const syntax = input.files
    .map((f) => ({ f, problem: syntaxProblem(f.path, f.after) }))
    .filter((x) => x.problem);
  add({
    id: "syntax",
    label: "Files parse",
    status: syntax.length ? "fail" : "pass",
    detail: syntax.length
      ? syntax.map((s) => `${s.f.path} — ${s.problem}`).join("; ")
      : "All proposed files parse",
  });

  add(ruleRecheck(input));

  return { ok: checks.every((c) => c.status !== "fail"), checks };
}
