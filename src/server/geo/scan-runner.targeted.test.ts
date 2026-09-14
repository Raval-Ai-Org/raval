import { describe, expect, it } from "vitest";
import type { SafeFetchOptions, SafeFetchResult } from "@/server/safe-fetch";
import type { Fetcher } from "./crawler.server";
import type { Renderer } from "./render.server";
import { advanceScan, type RunnerDeps } from "./scan-runner.server";
import { createMemoryGeoStore } from "./store.memory";
import type { ScanRow } from "./store.server";

type Resp = { status?: number; type?: string; body: string };

function fetcherFor(site: Record<string, Resp>) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (
    url: string,
    _opts: SafeFetchOptions,
  ): Promise<SafeFetchResult> => {
    calls.push(url);
    const r = site[url] ?? { status: 404, body: "<h1>Not found</h1>" };
    const status = r.status ?? 200;
    return {
      ok: status < 400,
      status,
      url,
      headers: new Headers({ "content-type": r.type ?? "text/html; charset=utf-8" }),
      bytes: new TextEncoder().encode(r.body),
      truncated: false,
      text: () => r.body,
    };
  };
  return { fetcher, calls };
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><main>${body}</main></body></html>`;

const SITE: Record<string, Resp> = {
  "https://acme.io/": {
    body: page(
      "Acme — invoicing for studios",
      `<h1>Acme</h1><p>${"Invoices. ".repeat(80)}</p><a href="/about">About</a><a href="/pricing">Pricing</a>`,
    ),
  },
  "https://acme.io/robots.txt": { type: "text/plain", body: "User-agent: *\nAllow: /" },
  "https://acme.io/about": {
    body: page("About Acme and the team", `<h1>About</h1><p>${"We build tools. ".repeat(40)}</p>`),
  },
  "https://acme.io/app": {
    body: '<!doctype html><html lang="en"><head><title>Acme app dashboard shell</title></head><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>',
  },
};

let seq = 0;
function seed(store: ReturnType<typeof createMemoryGeoStore>, over: Partial<ScanRow>): ScanRow {
  const row: ScanRow = {
    id: `t-${++seq}`,
    workspace_id: "ws-1",
    created_by: "u-1",
    url: "https://acme.io/",
    origin: "https://acme.io",
    host: "acme.io",
    mode: "targeted",
    trigger: "verification",
    status: "queued",
    stage: "queued",
    config: { maxPages: 3, maxDepth: 0, probes: false },
    site: {},
    progress: {},
    overall_score: null,
    cancel_requested: false,
    attempt_count: 0,
    lease_until: null,
    locked_by: null,
    error: null,
    created_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    ...over,
  };
  store.scans.set(row.id, row as ScanRow & Record<string, unknown>);
  return row;
}

async function run(
  store: ReturnType<typeof createMemoryGeoStore>,
  id: string,
  deps: Partial<RunnerDeps>,
) {
  for (let i = 0; i < 10; i++) {
    const [claimed] = await store.claimScans("w", 1, 150, id);
    if (!claimed) break;
    const r = await advanceScan(claimed, {
      store,
      fetcher: deps.fetcher!,
      worker: "w",
      deadline: Date.now() + 30_000,
      ...deps,
    });
    if (r === "done") break;
  }
  return store.scans.get(id)!;
}

describe("targeted verification scans", () => {
  it("reads exactly the requested pages and stays out of score history", async () => {
    const store = createMemoryGeoStore();
    const { fetcher, calls } = fetcherFor(SITE);
    const scan = seed(store, {
      config: { maxPages: 2, maxDepth: 0, probes: false, urls: ["https://acme.io/about"] },
    });
    const final = await run(store, scan.id, { fetcher });
    expect(final.status).toBe("succeeded");
    const pages = await store.loadPages(scan.id);
    expect(pages.map((p) => p.url)).toEqual(["https://acme.io/about"]);
    expect(calls).not.toContain("https://acme.io/pricing");
    expect(store.auditRuns).toHaveLength(0);
  });

  it("fails honestly when no requested page belongs to the site", async () => {
    const store = createMemoryGeoStore();
    const { fetcher } = fetcherFor(SITE);
    const scan = seed(store, {
      config: { maxPages: 2, maxDepth: 0, probes: false, urls: ["https://other.example/x"] },
    });
    const final = await run(store, scan.id, { fetcher });
    expect(final.status).toBe("failed");
  });
});

describe("rendering fallback", () => {
  const renderedHtml = `<!doctype html><html lang="en"><head><title>Acme app dashboard shell</title></head><body><div id="root"><main><h1>Dashboard</h1><p>${"Client rendered content about invoices. ".repeat(30)}</p></main></div></body></html>`;

  it("renders a client-side shell and analyses the rendered DOM, keeping raw HTML measurements", async () => {
    const store = createMemoryGeoStore();
    const { fetcher } = fetcherFor(SITE);
    const rendered: string[] = [];
    const render: Renderer = async (url) => {
      rendered.push(url);
      return { ok: true, html: renderedHtml, finalUrl: url, ms: 50, requests: 3, refused: 1 };
    };
    const scan = seed(store, {
      config: {
        maxPages: 3,
        maxDepth: 0,
        probes: false,
        urls: ["https://acme.io/app", "https://acme.io/about"],
      },
    });
    const final = await run(store, scan.id, { fetcher, render });
    expect(final.status).toBe("succeeded");
    expect(rendered).toEqual(["https://acme.io/app"]);
    const app = (await store.loadPages(scan.id)).find((p) => p.url === "https://acme.io/app")!;
    expect(app.analysis?.rendering).toMatchObject({ mode: "browser" });
    expect(app.analysis!.rendering!.renderedWords!).toBeGreaterThan(
      app.analysis!.rendering!.httpWords,
    );
    const findings = store.findings.get(scan.id)!;
    expect(
      findings.some((f) => f.ruleId === "perf.js_dependent_content" && f.pageUrl?.endsWith("/app")),
    ).toBe(true);
    expect(
      findings.some((f) => f.ruleId === "perf.server_rendered" && f.pageUrl?.endsWith("/app")),
    ).toBe(true);
  });

  it("records why rendering didn't happen instead of guessing", async () => {
    const store = createMemoryGeoStore();
    const { fetcher } = fetcherFor(SITE);
    const scan = seed(store, {
      config: { maxPages: 2, maxDepth: 0, probes: false, urls: ["https://acme.io/app"] },
    });
    await run(store, scan.id, {
      fetcher,
      renderUnavailableReason: "No Chromium is installed for browser rendering.",
    });
    const app = (await store.loadPages(scan.id))[0];
    expect(app.analysis?.rendering).toMatchObject({ mode: "http", renderedWords: null });
    expect(app.analysis?.rendering?.reason).toMatch(/Chromium/);
  });
});
