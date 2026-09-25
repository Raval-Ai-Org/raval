// repo-tools.server.ts — the read-only tools the GEO coding agent uses to
// investigate a connected repository and the scanned site.
//
//   list_files         paths (+ sizes) from a snapshot of the base commit
//   search_code        literal or safe-regex search over bounded blob reads
//   read_file          line-numbered file excerpts (recorded as "inspected")
//   get_page_facts     what Mellox's scan extracted from a page of this site
//   get_rule_info      the finding's rule, recipe and framework conventions
//   inspect_live_page  the live page's head and text via the SSRF-guarded fetcher
//
// Nothing here writes. Paths pass checkReadPath (no credentials, .git or
// dependency trees). Repository text and page text are wrapped as data and
// credential-shaped strings are redacted before anything reaches the model.
import "server-only";
import type { LlmTool, ToolOutcome } from "@/lib/ai-gateway.tool-loop.server";
import type { AgentFileInspected } from "@/lib/geo/agent-contracts";
import { checkReadPath } from "@/server/connectors/github/paths";
import type { TreeEntry } from "@/server/connectors/github/git.server";
import { SECRET_PATTERNS } from "../fixes/validate";

export const MAX_READ_LINES = 400;
export const MAX_BLOB_BYTES = 512_000;
const MAX_SEARCH_BLOBS_PER_CALL = 120;
const MAX_SEARCH_BYTES_PER_CALL = 6_000_000;
export const MAX_BLOBS_PER_RUN = 300;
const MAX_LIVE_FETCHES = 5;

const IGNORED_DIR =
  /(^|\/)(node_modules|\.git|dist|build|out|\.next|\.nuxt|\.output|\.svelte-kit|\.vercel|\.netlify|coverage|vendor|\.cache|\.turbo)\//;
const TEXT_EXT =
  /\.(html?|tsx?|jsx?|mjs|cjs|vue|svelte|astro|mdx?|json|ya?ml|toml|txt|xml|css|scss|njk|hbs|liquid|php|py|rb|go|webmanifest)$/i;
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|avif|ico|svg|woff2?|ttf|otf|eot|mp4|webm|mp3|pdf|zip|gz|lockb)$/i;

export type RepoSnapshot = {
  repo: string;
  branch: string;
  sha: string;
  entries: TreeEntry[];
  truncated: boolean;
  framework: string | null;
  frameworkEvidence: string | null;
};

export type PageFactsView = {
  url: string;
  statusCode: number | null;
  title: string | null;
  description: string | null;
  canonical: string | null;
  lang: string | null;
  h1: string[];
  headings: string[];
  schemaTypes: string[];
  wordCount: number;
  excerpt: string;
  rendering: string | null;
};

export type RepoToolDeps = {
  readBlob: (sha: string) => Promise<string | null>;
  /** Live page through the SSRF-guarded fetcher (null on failure). */
  fetchLive: (url: string) => Promise<{ status: number; html: string } | null>;
  /** Scan facts for pages of the scanned site. */
  pageFacts: (url: string | null) => Promise<PageFactsView[]>;
  ruleInfo: () => string;
};

export type RepoToolState = {
  blobsRead: number;
  liveFetches: number;
  /** Paths whose content the agent actually read (plans may only update these). */
  filesRead: Set<string>;
  inspected: AgentFileInspected[];
};

export function newToolState(): RepoToolState {
  return { blobsRead: 0, liveFetches: 0, filesRead: new Set(), inspected: [] };
}

/* ───────────────────────── helpers ───────────────────────── */

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(
      new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`),
      "[REDACTED]",
    );
  }
  // KEY=value lines in env-like snippets.
  return out.replace(
    /\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z0-9_]*)\s*[:=]\s*["']?[^\s"']{8,}/g,
    "$1=[REDACTED]",
  );
}

/** Glob → RegExp: `**` any depth, `*` within a segment, `?`, `{a,b}`. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += glob[i + 2] === "/" ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) re += "\\{";
      else {
        re += `(?:${glob
          .slice(i + 1, end)
          .split(",")
          .map((p) => p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
          .join("|")})`;
        i = end;
      }
    } else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

/** Reject patterns that can backtrack catastrophically or are too long. */
export function safeRegex(pattern: string): RegExp | null {
  if (!pattern || pattern.length > 200) return null;
  if (/\\\d/.test(pattern)) return null; // backreferences
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(pattern)) return null; // nested quantifiers
  if (/(\.\*){3,}/.test(pattern)) return null;
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

function wrapFile(path: string, from: number, to: number, body: string) {
  return `<repo_file path="${path}" lines="${from}-${to}">\n${body}\n</repo_file>`;
}

const str = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback;

/* ───────────────────────── tool definitions ───────────────────────── */

export const REPO_TOOLS: LlmTool[] = [
  {
    name: "list_files",
    description:
      "List repository file paths (with sizes in bytes) matching a glob, from the base commit. Use it to find layouts, route files, head/metadata helpers, public/static folders and config. Dependency, build and credential files are never listed.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob, e.g. src/**/*.tsx, **/layout.*, public/*" },
        limit: { type: "integer", description: "Max paths to return (≤ 400)." },
      },
      required: ["pattern", "limit"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "search_code",
    description:
      "Search text files for a literal string (default) or a simple regular expression. Returns path:line matches with one line of context. Use it to find where the <title>, meta tags, canonical, JSON-LD, headings or page copy are defined.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        regex: { type: "boolean", description: "Treat query as a regular expression." },
        path_pattern: {
          type: "string",
          description: "Glob limiting the files searched; use ** for all.",
        },
        max_results: { type: "integer", description: "≤ 60" },
      },
      required: ["query", "regex", "path_pattern", "max_results"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "read_file",
    description:
      "Read a line range of a repository file (≤ 400 lines per call, line-numbered). Give the reason you need it — it is shown to the user. You may only plan changes to files you have read.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "integer" },
        end_line: { type: "integer" },
        reason: {
          type: "string",
          description: "One short sentence: why this file matters for the fix.",
        },
      },
      required: ["path", "start_line", "end_line", "reason"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_page_facts",
    description:
      "What Mellox's scan extracted from a page of the scanned site: status, title, description, canonical, headings, schema types, word count, text excerpt, rendering mode. Pass null for the affected page.",
    input_schema: {
      type: "object",
      properties: { url: { type: ["string", "null"] } },
      required: ["url"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_rule_info",
    description:
      "The finding's rule: what it checks, why it matters, the recommended fix recipe, likely target files for this framework, and the framework's conventions.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "inspect_live_page",
    description:
      "Fetch a path on the scanned site (same host only) and return its HTML <head> tags and a text excerpt — use it to compare what is served with what the repository contains. At most 5 calls per run.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path on the scanned site, e.g. / or /pricing" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    strict: true,
  },
];

/* ───────────────────────── handlers ───────────────────────── */

export function createRepoToolHandlers(args: {
  snapshot: RepoSnapshot;
  siteOrigin: string;
  deps: RepoToolDeps;
  state: RepoToolState;
  /** Restrict read_file / search_code to these paths (implementation stage). */
  allowPaths?: (path: string) => boolean;
}) {
  const { snapshot, deps, state } = args;
  const byPath = new Map(
    snapshot.entries
      .filter((e) => !IGNORED_DIR.test(e.path) && checkReadPath(e.path).ok)
      .map((e) => [e.path, e]),
  );
  const blobCache = new Map<string, string | null>();

  const readText = async (entry: TreeEntry): Promise<string | null> => {
    if (entry.size > MAX_BLOB_BYTES || BINARY_EXT.test(entry.path)) return null;
    if (blobCache.has(entry.sha)) return blobCache.get(entry.sha)!;
    if (state.blobsRead >= MAX_BLOBS_PER_RUN)
      throw new Error("File read budget for this run is used up.");
    state.blobsRead++;
    const text = await deps.readBlob(entry.sha);
    blobCache.set(entry.sha, text);
    return text;
  };

  const allowed = (path: string) => (args.allowPaths ? args.allowPaths(path) : true);

  async function listFiles(input: Record<string, unknown>): Promise<ToolOutcome> {
    const pattern = str(input.pattern, 200) || "**";
    const limit = Math.max(1, Math.min(400, int(input.limit, 200)));
    const re = globToRegExp(pattern);
    const hits = [...byPath.values()].filter((e) => re.test(e.path));
    const shown = hits.slice(0, limit);
    return {
      content:
        (shown.length ? shown.map((e) => `${e.path} (${e.size})`).join("\n") : "No files match.") +
        (hits.length > shown.length ? `\n…${hits.length - shown.length} more` : "") +
        (snapshot.truncated
          ? "\nNote: the repository listing is partial (very large repository)."
          : ""),
      summary: `Listed ${hits.length} file(s) matching ${pattern}`,
      detail: { pattern, matches: hits.length },
    };
  }

  async function searchCode(input: Record<string, unknown>): Promise<ToolOutcome> {
    const query = str(input.query, 200);
    if (!query) return { content: "Empty query.", isError: true, summary: "Empty search" };
    const useRegex = input.regex === true;
    const re = useRegex ? safeRegex(query) : null;
    if (useRegex && !re) {
      return {
        content:
          "That regular expression isn't allowed (too long, backreferences or nested quantifiers). Use a literal search.",
        isError: true,
        summary: "Rejected an unsafe search pattern",
      };
    }
    const needle = query.toLowerCase();
    const pathRe = globToRegExp(str(input.path_pattern, 200) || "**");
    const maxResults = Math.max(1, Math.min(60, int(input.max_results, 30)));
    const candidates = [...byPath.values()]
      .filter(
        (e) =>
          pathRe.test(e.path) &&
          TEXT_EXT.test(e.path) &&
          e.size <= MAX_BLOB_BYTES &&
          allowed(e.path),
      )
      .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.size - b.size);
    const results: string[] = [];
    let files = 0;
    let bytes = 0;
    let skipped = 0;
    for (const e of candidates) {
      if (results.length >= maxResults) break;
      if (files >= MAX_SEARCH_BLOBS_PER_CALL || bytes + e.size > MAX_SEARCH_BYTES_PER_CALL) {
        skipped = candidates.length - files;
        break;
      }
      files++;
      bytes += e.size;
      const text = await readText(e);
      if (!text) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        const line = lines[i];
        if (line.length > 2000) continue;
        const hit = re ? re.test(line) : line.toLowerCase().includes(needle);
        if (!hit) continue;
        const ctx = [lines[i - 1], line, lines[i + 1]]
          .map((l, k) => (l === undefined ? null : `${i + k}: ${l.slice(0, 240)}`))
          .filter(Boolean)
          .join("\n");
        results.push(`${e.path}:${i + 1}\n${redactSecrets(ctx)}`);
      }
    }
    return {
      content:
        (results.length ? results.join("\n---\n") : "No matches.") +
        (skipped ? `\n(${skipped} more file(s) not searched — narrow path_pattern.)` : ""),
      summary: `Searched ${files} file(s) for “${query.slice(0, 60)}” — ${results.length} match(es)`,
      detail: { query: query.slice(0, 120), regex: useRegex, files, matches: results.length },
    };
  }

  async function readFile(input: Record<string, unknown>): Promise<ToolOutcome> {
    const path = str(input.path, 300).replace(/^\.?\//, "");
    const check = checkReadPath(path);
    if (!check.ok)
      return { content: check.reason, isError: true, summary: `Refused to read ${path}` };
    const entry = byPath.get(path);
    if (!entry)
      return {
        content: `${path} doesn't exist in ${snapshot.branch}.`,
        isError: true,
        summary: `${path} not found`,
      };
    if (!allowed(path)) {
      return {
        content: `${path} isn't part of the approved plan.`,
        isError: true,
        summary: `Not in plan: ${path}`,
      };
    }
    const text = await readText(entry);
    if (text === null) {
      return {
        content: `${path} is binary or larger than ${Math.round(MAX_BLOB_BYTES / 1000)} KB and can't be read.`,
        isError: true,
        summary: `Couldn't read ${path}`,
      };
    }
    const lines = text.split(/\r?\n/);
    const start = Math.max(1, int(input.start_line, 1));
    const end = Math.min(
      lines.length,
      Math.max(start, int(input.end_line, start + MAX_READ_LINES - 1)),
      start + MAX_READ_LINES - 1,
    );
    const body = lines
      .slice(start - 1, end)
      .map((l, i) => `${start + i}\t${l}`)
      .join("\n");
    state.filesRead.add(path);
    const reason = str(input.reason, 200) || "Inspected";
    if (!state.inspected.some((f) => f.path === path)) {
      state.inspected.push({ path, reason, lines: `${start}-${end}`, via: "read_file" });
    }
    return {
      content: `${wrapFile(path, start, end, redactSecrets(body))}${end < lines.length ? `\n(${lines.length} lines total)` : ""}`,
      summary: `Read ${path} (lines ${start}–${end}): ${reason}`.slice(0, 280),
      detail: { path, lines: `${start}-${end}`, total: lines.length },
    };
  }

  async function pageFacts(input: Record<string, unknown>): Promise<ToolOutcome> {
    const url = typeof input.url === "string" ? input.url.slice(0, 500) : null;
    if (url) {
      try {
        if (new URL(url).origin !== new URL(args.siteOrigin).origin) {
          return {
            content: "Only pages of the scanned site are available.",
            isError: true,
            summary: "Refused another site's page",
          };
        }
      } catch {
        return { content: "Invalid URL.", isError: true, summary: "Invalid page URL" };
      }
    }
    const facts = await deps.pageFacts(url);
    if (!facts.length)
      return {
        content: "The scan has no analysed page for that URL.",
        summary: "No scan facts for that page",
      };
    return {
      content: `<page_facts>\n${redactSecrets(JSON.stringify(facts.slice(0, 5), null, 1))}\n</page_facts>`,
      summary: `Looked up scan facts for ${facts[0].url}`,
      detail: { url: facts[0].url },
    };
  }

  async function ruleInfo(): Promise<ToolOutcome> {
    return { content: deps.ruleInfo(), summary: "Read the rule, recipe and framework conventions" };
  }

  async function inspectLive(input: Record<string, unknown>): Promise<ToolOutcome> {
    if (state.liveFetches >= MAX_LIVE_FETCHES)
      return {
        content: "Live page budget used up.",
        isError: true,
        summary: "Live fetch limit reached",
      };
    const raw = str(input.path, 300) || "/";
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//") || raw.includes("\\")) {
      return {
        content: "Give a path on the scanned site, not a URL.",
        isError: true,
        summary: "Refused a live fetch",
      };
    }
    let url: URL;
    try {
      url = new URL(raw.startsWith("/") ? raw : `/${raw}`, args.siteOrigin);
      if (url.origin !== new URL(args.siteOrigin).origin) throw new Error("other origin");
    } catch {
      return {
        content: "Only paths on the scanned site can be fetched.",
        isError: true,
        summary: "Refused a live fetch",
      };
    }
    state.liveFetches++;
    const res = await deps.fetchLive(url.toString());
    if (!res)
      return {
        content: `Couldn't fetch ${url}.`,
        isError: true,
        summary: `Live fetch of ${url.pathname} failed`,
      };
    const head = (/<head[\s\S]*?<\/head>/i.exec(res.html)?.[0] ?? "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, "")
      .slice(0, 8000);
    const text = res.html
      .replace(/<head[\s\S]*?<\/head>/i, "")
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);
    return {
      content: `<live_page url="${url}" status="${res.status}">\n<head_tags>\n${redactSecrets(head)}\n</head_tags>\n<text>${redactSecrets(text)}</text>\n</live_page>`,
      summary: `Fetched the live page ${url.pathname} (HTTP ${res.status})`,
      detail: { url: url.toString(), status: res.status },
    };
  }

  const handlers: Record<string, (input: Record<string, unknown>) => Promise<ToolOutcome>> = {
    list_files: listFiles,
    search_code: searchCode,
    read_file: readFile,
    get_page_facts: pageFacts,
    get_rule_info: ruleInfo,
    inspect_live_page: inspectLive,
  };

  return {
    has: (name: string) => name in handlers,
    async handle(name: string, input: unknown): Promise<ToolOutcome> {
      const fn = handlers[name];
      if (!fn)
        return { content: `Unknown tool ${name}.`, isError: true, summary: `Unknown tool ${name}` };
      const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      return fn(obj);
    },
    exists: (path: string) => byPath.has(path),
  };
}
