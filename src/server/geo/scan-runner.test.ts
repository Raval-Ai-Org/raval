import { describe, expect, it, vi } from "vitest";
import { SsrfBlockedError, type SafeFetchOptions, type SafeFetchResult } from "@/server/safe-fetch";
import { fetchWithRetry, normalizeCrawlUrl, type Fetcher } from "./crawler.server";
import { advanceScan, type RunnerDeps } from "./scan-runner.server";
import { createMemoryGeoStore } from "./store.memory";
import type { ScanRow } from "./store.server";

type Resp = { status?: number; type?: string; body: string; headers?: Record<string, string> };

function fakeFetcher(site: Record<string, Resp | (() => Resp)>) {
  const calls: string[] = [];
  const fetcher: Fetcher = async (
    url: string,
    _opts: SafeFetchOptions,
  ): Promise<SafeFetchResult> => {
    calls.push(url);
    const entry = site[url];
    const r =
      typeof entry === "function"
        ? entry()
        : (entry ?? { status: 404, type: "text/html", body: "<h1>Not found</h1>" });
    const bytes = new TextEncoder().encode(r.body);
    const headers = new Headers({
      "content-type": r.type ?? "text/html; charset=utf-8",
      ...(r.headers ?? {}),
    });
    const status = r.status ?? 200;
    return { ok: status < 400, status, url, headers, bytes, truncated: false, text: () => r.body };
  };
  return { fetcher, calls };
}

const html = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><main>${body}</main></body></html>`;

const SITE: Record<string, Resp> = {
  "https://acme.io/": {
    body: html(
      "Acme — invoicing for studios",
      `<h1>Acme invoicing</h1><p>${"Acme sends invoices and chases payments. ".repeat(30)}</p>
       <a href="/about">About us</a> <a href="/blog/post-1">Read the guide</a>
       <a href="/private/secret">Secret</a> <a href="/missing">Old page</a> <a href="/brochure.pdf">PDF</a>`,
    ),
  },
  "https://acme.io/robots.txt": {
    type: "text/plain",
    body: "User-agent: *\nDisallow: /private\nSitemap: https://acme.io/sitemap.xml",
  },
  "https://acme.io/sitemap.xml": {
    type: "application/xml",
    body: "<urlset><url><loc>https://acme.io/</loc></url><url><loc>https://acme.io/about</loc></url></urlset>",
  },
  "https://acme.io/llms.txt": { type: "text/plain", body: "# Acme\n\n> Invoicing for studios" },
  "https://acme.io/about": {
    body: html("About Acme", "<h1>About</h1><p>We are a small team.</p>"),
  },
  "https://acme.io/blog/post-1": {
    body: html("How to get paid on time", "<h1>Get paid</h1><p>Send invoices early.</p>"),
  },
};

let scanSeq = 0;
function seedScan(
  store: ReturnType<typeof createMemoryGeoStore>,
  over: Partial<ScanRow> = {},
): ScanRow {
  const id = `scan-${++scanSeq}`;
  const row: ScanRow = {
    id,
    workspace_id: "ws-1",
    created_by: "user-1",
    url: "https://acme.io/",
    origin: "https://acme.io",
    host: "acme.io",
    mode: "full",
    trigger: "manual",
    status: "queued",
    stage: "queued",
    config: { maxPages: 20, maxDepth: 5, probes: false },
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
  store.scans.set(id, row as ScanRow & Record<string, unknown>);
  return row;
}

async function runToEnd(
  store: ReturnType<typeof createMemoryGeoStore>,
  scanId: string,
  deps: Partial<RunnerDeps>,
) {
  for (let i = 0; i < 10; i++) {
    const [claimed] = await store.claimScans("w1", 1, 150, scanId);
    if (!claimed) break;
    const result = await advanceScan(claimed, {
      store,
      fetcher: deps.fetcher!,
      worker: "w1",
      deadline: Date.now() + 30_000,
      ...deps,
    });
    if (result === "done") break;
  }
  return store.scans.get(scanId)!;
}

describe("scan runner", () => {
  it("crawls a site within robots.txt rules, scores it and records history", async () => {
    const store = createMemoryGeoStore();
    const { fetcher, calls } = fakeFetcher(SITE);
    const scan = seedScan(store);
    const final = await runToEnd(store, scan.id, { fetcher });

    expect(final.status).toBe("succeeded");
    expect(final.overall_score).toBeGreaterThan(0);
    const pages = await store.loadPages(scan.id);
    const byUrl = Object.fromEntries(pages.map((p) => [p.url, p]));
    expect(byUrl["https://acme.io/"].state).toBe("fetched");
    expect(byUrl["https://acme.io/about"].state).toBe("fetched");
    expect(byUrl["https://acme.io/blog/post-1"].state).toBe("fetched");
    expect(byUrl["https://acme.io/missing"]).toMatchObject({ state: "fetched", status_code: 404 });
    expect(byUrl["https://acme.io/private/secret"]).toMatchObject({
      state: "skipped",
      skip_reason: "Disallowed by robots.txt",
    });
    expect(byUrl["https://acme.io/brochure.pdf"]).toBeUndefined();
    expect(calls).not.toContain("https://acme.io/private/secret");
    // The homepage is fetched once, during discovery.
    expect(calls.filter((c) => c === "https://acme.io/")).toHaveLength(1);

    const findings = store.findings.get(scan.id)!;
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.ruleId === "tech.broken_links")).toBe(true);
    expect(store.auditRuns).toHaveLength(1);
    expect(store.auditRuns[0]).toMatchObject({ workspace_id: "ws-1", score: final.overall_score });
  });

  it("quick mode analyzes the homepage only", async () => {
    const store = createMemoryGeoStore();
    const { fetcher, calls } = fakeFetcher(SITE);
    const scan = seedScan(store, {
      mode: "quick",
      config: { maxPages: 1, maxDepth: 0, probes: false },
    });
    const final = await runToEnd(store, scan.id, { fetcher });
    expect(final.status).toBe("succeeded");
    expect(await store.loadPages(scan.id)).toHaveLength(1);
    expect(calls).not.toContain("https://acme.io/about");
  });

  it("yields at its deadline and resumes without refetching", async () => {
    const store = createMemoryGeoStore();
    const { fetcher, calls } = fakeFetcher(SITE);
    const scan = seedScan(store);
    const [claimed] = await store.claimScans("w1", 1, 150, scan.id);
    expect(
      await advanceScan(claimed, { store, fetcher, worker: "w1", deadline: Date.now() - 1 }),
    ).toBe("yield");
    expect(store.scans.get(scan.id)!.status).toBe("running");
    const final = await runToEnd(store, scan.id, { fetcher });
    expect(final.status).toBe("succeeded");
    expect(calls.filter((c) => c === "https://acme.io/about")).toHaveLength(1);
  });

  it("honours cancellation and fails unreachable or private targets", async () => {
    const store = createMemoryGeoStore();
    const { fetcher } = fakeFetcher(SITE);
    const cancelled = seedScan(store, { cancel_requested: true });
    expect((await runToEnd(store, cancelled.id, { fetcher })).status).toBe("cancelled");

    const blocked = seedScan(store, { url: "https://internal.acme.io/" });
    const ssrf: Fetcher = async () => {
      throw new SsrfBlockedError("resolves to a non-public address");
    };
    const failed = await runToEnd(store, blocked.id, { fetcher: ssrf });
    expect(failed).toMatchObject({ status: "failed", error: "That URL is not allowed." });
  });

  it("stops writing once another worker holds the lease", async () => {
    const store = createMemoryGeoStore();
    const { fetcher } = fakeFetcher(SITE);
    const scan = seedScan(store);
    const [claimed] = await store.claimScans("w1", 1, 150, scan.id);
    store.scans.get(scan.id)!.locked_by = "w2";
    expect(
      await advanceScan(claimed, { store, fetcher, worker: "w1", deadline: Date.now() + 30_000 }),
    ).toBe("lost_lease");
  });
});

describe("crawler helpers", () => {
  it("keeps the crawl on-site and strips tracking noise", () => {
    expect(normalizeCrawlUrl("https://WWW.acme.io/a?utm_source=x#top", "acme.io")).toBe(
      "https://www.acme.io/a",
    );
    expect(normalizeCrawlUrl("https://other.io/a", "acme.io")).toBeNull();
    expect(normalizeCrawlUrl("https://acme.io/file.pdf", "acme.io")).toBeNull();
    expect(normalizeCrawlUrl("https://acme.io/cart/", "acme.io")).toBeNull();
    expect(normalizeCrawlUrl("mailto:a@acme.io", "acme.io")).toBeNull();
    expect(normalizeCrawlUrl("https://acme.io/s?a=1&b=2&c=3&d=4", "acme.io")).toBeNull();
  });

  it("retries transient failures but not client errors", async () => {
    let n = 0;
    const { fetcher } = fakeFetcher({
      "https://acme.io/flaky": () =>
        ++n === 1 ? { status: 503, body: "busy" } : { body: "<p>ok</p>" },
      "https://acme.io/gone": { status: 404, body: "no" },
    });
    const spy = vi.fn(fetcher);
    expect((await fetchWithRetry(spy, "https://acme.io/flaky", { retries: 2 })).status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockClear();
    expect((await fetchWithRetry(spy, "https://acme.io/gone", { retries: 2 })).status).toBe(404);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
