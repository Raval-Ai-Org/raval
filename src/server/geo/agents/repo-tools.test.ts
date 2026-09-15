import { describe, expect, it } from "vitest";
import {
  createRepoToolHandlers,
  globToRegExp,
  MAX_BLOBS_PER_RUN,
  newToolState,
  redactSecrets,
  safeRegex,
  type RepoSnapshot,
  type RepoToolDeps,
} from "./repo-tools.server";

const sha = (n: number) => n.toString(16).padStart(40, "0");

function repo(files: Record<string, string>, extra: { path: string; size: number }[] = []) {
  const entries = Object.entries(files).map(([path, text], i) => ({
    path,
    sha: sha(i + 1),
    size: Buffer.byteLength(text),
  }));
  const blobs = new Map(entries.map((e) => [e.sha, files[e.path]]));
  for (const [i, e] of extra.entries())
    entries.push({ path: e.path, sha: sha(1000 + i), size: e.size });
  const snapshot: RepoSnapshot = {
    repo: "acme/site",
    branch: "main",
    sha: sha(999),
    entries,
    truncated: false,
    framework: "Next.js",
    frameworkEvidence: "package.json depends on next",
  };
  let reads = 0;
  const deps: RepoToolDeps = {
    readBlob: async (s) => {
      reads++;
      return blobs.get(s) ?? null;
    },
    fetchLive: async (url) => ({
      status: 200,
      html: `<html><head><title>Live ${url}</title></head><body><h1>Hi</h1></body></html>`,
    }),
    pageFacts: async (url) => [
      {
        url: url ?? "https://acme.test/",
        statusCode: 200,
        title: "Acme",
        description: null,
        canonical: null,
        lang: "en",
        h1: ["Acme"],
        headings: [],
        schemaTypes: [],
        wordCount: 120,
        excerpt: "Acme builds rockets.",
        rendering: "http",
      },
    ],
    ruleInfo: () => "rule tech.meta_description",
  };
  return { snapshot, deps, reads: () => reads };
}

const FILES = {
  "app/layout.tsx":
    'export const metadata = { title: "Acme" };\nexport default function L({children}){return children}\n',
  "app/page.tsx": "export default function Page(){ return <h1>Acme</h1> }\n",
  ".env.local": "ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwxyz0123\n",
  "config/keys.pem": "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
  "node_modules/next/index.js": "module.exports = {}",
  "lib/site.ts":
    'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB";\nexport const url = "https://acme.test";\n',
};

describe("repo tool helpers", () => {
  it("converts globs", () => {
    expect(globToRegExp("app/**/*.tsx").test("app/blog/[slug]/page.tsx")).toBe(true);
    expect(globToRegExp("app/**/*.tsx").test("app/page.tsx")).toBe(true);
    expect(globToRegExp("*.tsx").test("app/page.tsx")).toBe(false);
    expect(globToRegExp("**/layout.{tsx,jsx}").test("src/app/layout.jsx")).toBe(true);
  });

  it("rejects unsafe regular expressions", () => {
    expect(safeRegex("(a+)+$")).toBeNull();
    expect(safeRegex("(\\w)\\1")).toBeNull();
    expect(safeRegex("x".repeat(201))).toBeNull();
    expect(safeRegex("[unclosed")).toBeNull();
    expect(safeRegex("<title>.*</title>")).toBeInstanceOf(RegExp);
  });

  it("redacts credential-shaped strings", () => {
    const out = redactSecrets(
      'const t = "ghp_abcdefghijklmnopqrstuvwxyz0123456789AB"; STRIPE_SECRET_KEY=sk_live_abcdefgh',
    );
    expect(out).not.toContain("ghp_abcdefghij");
    expect(out).toContain("[REDACTED]");
  });
});

describe("repo tools", () => {
  it("lists files without dependency trees or credential files", async () => {
    const r = repo(FILES);
    const tools = createRepoToolHandlers({
      snapshot: r.snapshot,
      siteOrigin: "https://acme.test",
      deps: r.deps,
      state: newToolState(),
    });
    const out = await tools.handle("list_files", { pattern: "**", limit: 50 });
    expect(out.content).toContain("app/layout.tsx");
    expect(out.content).not.toContain(".env.local");
    expect(out.content).not.toContain("keys.pem");
    expect(out.content).not.toContain("node_modules");
  });

  it("refuses traversal, absolute and credential paths", async () => {
    const r = repo(FILES);
    const tools = createRepoToolHandlers({
      snapshot: r.snapshot,
      siteOrigin: "https://acme.test",
      deps: r.deps,
      state: newToolState(),
    });
    for (const path of [
      "../etc/passwd",
      "/etc/passwd",
      "app\\page.tsx",
      ".env.local",
      "config/keys.pem",
      ".git/config",
      "node_modules/next/index.js",
    ]) {
      const out = await tools.handle("read_file", {
        path,
        start_line: 1,
        end_line: 10,
        reason: "x",
      });
      expect(out.isError, path).toBe(true);
    }
    expect(r.reads()).toBe(0);
  });

  it("reads line ranges, records inspected files and redacts secrets", async () => {
    const r = repo(FILES);
    const state = newToolState();
    const tools = createRepoToolHandlers({
      snapshot: r.snapshot,
      siteOrigin: "https://acme.test",
      deps: r.deps,
      state,
    });
    const out = await tools.handle("read_file", {
      path: "lib/site.ts",
      start_line: 1,
      end_line: 5000,
      reason: "Where the site URL lives",
    });
    expect(out.isError).toBeFalsy();
    expect(out.content).toContain('<repo_file path="lib/site.ts" lines="1-3">');
    expect(out.content).not.toContain("ghp_abcdefghij");
    expect(state.filesRead.has("lib/site.ts")).toBe(true);
    expect(state.inspected[0]).toMatchObject({
      path: "lib/site.ts",
      reason: "Where the site URL lives",
    });
    const missing = await tools.handle("read_file", {
      path: "app/nope.tsx",
      start_line: 1,
      end_line: 2,
      reason: "x",
    });
    expect(missing.isError).toBe(true);
  });

  it("searches literally or with a safe regex, within a path glob", async () => {
    const r = repo(FILES);
    const tools = createRepoToolHandlers({
      snapshot: r.snapshot,
      siteOrigin: "https://acme.test",
      deps: r.deps,
      state: newToolState(),
    });
    const lit = await tools.handle("search_code", {
      query: "metadata",
      regex: false,
      path_pattern: "app/**",
      max_results: 10,
    });
    expect(lit.content).toContain("app/layout.tsx:1");
    const rx = await tools.handle("search_code", {
      query: 'title:\\s*"',
      regex: true,
      path_pattern: "**",
      max_results: 10,
    });
    expect(rx.content).toContain("app/layout.tsx:1");
    const bad = await tools.handle("search_code", {
      query: "(a+)+",
      regex: true,
      path_pattern: "**",
      max_results: 10,
    });
    expect(bad.isError).toBe(true);
    const env = await tools.handle("search_code", {
      query: "ANTHROPIC",
      regex: false,
      path_pattern: "**",
      max_results: 10,
    });
    expect(env.content).toBe("No matches.");
  });

  it("stops reading once the per-run blob budget is spent", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < MAX_BLOBS_PER_RUN + 5; i++) many[`content/p${i}.md`] = `page ${i}`;
    const r = repo(many);
    const state = newToolState();
    const tools = createRepoToolHandlers({
      snapshot: r.snapshot,
      siteOrigin: "https://acme.test",
      deps: r.deps,
      state,
    });
    for (let k = 0; k < 4; k++) {
      await tools
        .handle("search_code", {
          query: "zzz",
          regex: false,
          path_pattern: "content/**",
          max_results: 5,
        })
        .catch(() => null);
    }
    expect(r.reads()).toBeLessThanOrEqual(MAX_BLOBS_PER_RUN);
  });

  it("skips binary and oversized files", async () => {
    const r = repo(FILES, [
      { path: "public/hero.png", size: 1000 },
      { path: "public/huge.html", size: 900_000 },
    ]);
    const tools = createRepoToolHandlers({
      snapshot: r.snapshot,
      siteOrigin: "https://acme.test",
      deps: r.deps,
      state: newToolState(),
    });
    const big = await tools.handle("read_file", {
      path: "public/huge.html",
      start_line: 1,
      end_line: 10,
      reason: "x",
    });
    expect(big.isError).toBe(true);
    expect(big.content).toMatch(/larger than/);
  });

  it("limits implementation-stage reads to allowed paths", async () => {
    const r = repo(FILES);
    const tools = createRepoToolHandlers({
      snapshot: r.snapshot,
      siteOrigin: "https://acme.test",
      deps: r.deps,
      state: newToolState(),
      allowPaths: (p) => p === "app/layout.tsx",
    });
    expect(
      (
        await tools.handle("read_file", {
          path: "app/page.tsx",
          start_line: 1,
          end_line: 2,
          reason: "x",
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await tools.handle("read_file", {
          path: "app/layout.tsx",
          start_line: 1,
          end_line: 2,
          reason: "x",
        })
      ).isError,
    ).toBeFalsy();
  });

  it("only fetches live pages and facts for the scanned site", async () => {
    const r = repo(FILES);
    const tools = createRepoToolHandlers({
      snapshot: r.snapshot,
      siteOrigin: "https://acme.test",
      deps: r.deps,
      state: newToolState(),
    });
    expect((await tools.handle("inspect_live_page", { path: "https://evil.test/x" })).isError).toBe(
      true,
    );
    expect((await tools.handle("inspect_live_page", { path: "//evil.test/x" })).isError).toBe(true);
    const ok = await tools.handle("inspect_live_page", { path: "/pricing" });
    expect(ok.content).toContain('<live_page url="https://acme.test/pricing"');
    expect((await tools.handle("get_page_facts", { url: "https://evil.test/" })).isError).toBe(
      true,
    );
    expect((await tools.handle("get_page_facts", { url: null })).content).toContain("<page_facts>");
    expect((await tools.handle("unknown_tool", {})).isError).toBe(true);
  });
});
