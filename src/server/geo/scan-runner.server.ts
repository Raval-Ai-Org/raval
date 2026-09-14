// scan-runner.server.ts — the AI Visibility scan state machine.
//
//   queued → discovering → crawling → analyzing → (probing) → done
//
// A scan advances in time-boxed slices under a lease (claim_geo_scans), so
// no single request or cron call has to hold a whole crawl: a slice that runs
// out of time checkpoints its progress in the database and yields, and the
// next claim resumes where it stopped. Pages already fetched are never
// fetched again, and re-running the analyze stage replaces its outputs.
import "server-only";
import { analyzePage } from "@/lib/geo/analyze-page";
import { needsRendering } from "@/lib/geo/rendering";
import { crawlDelayFor, isPathAllowed } from "@/lib/geo/robots";
import { scoreScan } from "@/lib/geo/score";
import type { GeoAction, PageAnalysis, SiteArtifacts } from "@/lib/geo/types";
import type { Renderer } from "./render.server";
import {
  discoverSiteArtifacts,
  fetchWithRetry,
  GEO_CRAWLER_TOKEN,
  isHtmlResponse,
  normalizeCrawlUrl,
  siteHost,
  type Fetcher,
} from "./crawler.server";
import { pageRowToCrawled, type GeoStore, type PageRow, type ScanRow } from "./store.server";

export const LEASE_SECONDS = 150;
/** A scan that keeps getting claimed without finishing is failed, not retried forever. */
export const MAX_ATTEMPTS = 60;
const CONCURRENCY = 3;
const MIN_REQUEST_GAP_MS = 150;

export type ProbeRunner = (scan: ScanRow, context: ProbeContext) => Promise<unknown>;
export type ProbeContext = {
  site: SiteArtifacts;
  brandName: string | null;
  topics: string[];
  pageUrls: string[];
};

export type RunnerDeps = {
  store: GeoStore;
  fetcher: Fetcher;
  worker: string;
  /** Epoch ms after which the slice checkpoints and yields. */
  deadline: number;
  now?: () => number;
  probes?: ProbeRunner;
  /** Browser rendering for client-rendered shells; absent when unavailable. */
  render?: Renderer;
  /** Why rendering is unavailable (shown on pages that needed it). */
  renderUnavailableReason?: string;
  log?: (message: string, detail?: unknown) => void;
};

/** Default per-scan browser-render allowance by mode. */
export function defaultMaxRenders(mode: ScanRow["mode"], urls = 0): number {
  return mode === "full" ? 10 : mode === "targeted" ? Math.min(20, urls + 1) : 1;
}

export type SliceResult = "done" | "yield" | "lost_lease";

class LeaseLostError extends Error {}

const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function actionPriorityLegacy(p: GeoAction["priority"]): "high" | "med" | "low" {
  return p === "critical" || p === "high" ? "high" : p === "medium" ? "med" : "low";
}

async function write(
  deps: RunnerDeps,
  scan: ScanRow,
  patch: Parameters<GeoStore["updateScan"]>[2],
) {
  const ok = await deps.store.updateScan(scan.id, deps.worker, patch);
  if (!ok) throw new LeaseLostError(`Lease on scan ${scan.id} was lost`);
  Object.assign(scan, patch);
}

async function finish(
  deps: RunnerDeps,
  scan: ScanRow,
  status: "failed" | "cancelled",
  error: string | null,
): Promise<SliceResult> {
  await write(deps, scan, {
    status,
    stage: "done",
    error,
    completed_at: nowIso(),
    lease_until: null,
  });
  return "done";
}

/** Advance one claimed scan until it finishes, yields at the deadline, or loses its lease. */
export async function advanceScan(scan: ScanRow, deps: RunnerDeps): Promise<SliceResult> {
  const now = deps.now ?? Date.now;
  try {
    if (scan.cancel_requested) return await finish(deps, scan, "cancelled", null);
    if (scan.attempt_count > MAX_ATTEMPTS) {
      return await finish(
        deps,
        scan,
        "failed",
        "The scan did not complete. Try a smaller scan or run it again.",
      );
    }

    for (;;) {
      if (now() >= deps.deadline) return await yieldScan(deps, scan);
      switch (scan.stage) {
        case "queued":
        case "discovering": {
          const outcome = await discover(scan, deps);
          if (outcome) return outcome;
          break;
        }
        case "crawling": {
          const finished = await crawl(scan, deps);
          if (!finished) return await yieldScan(deps, scan);
          break;
        }
        case "analyzing":
          await analyze(scan, deps);
          break;
        case "probing":
          await probe(scan, deps);
          break;
        case "done":
          return "done";
      }
      if (scan.status !== "running" && scan.status !== "queued") return "done";
    }
  } catch (error) {
    if (error instanceof LeaseLostError) return "lost_lease";
    const message = error instanceof Error ? error.message : String(error);
    deps.log?.(`[geo] scan ${scan.id} failed in ${scan.stage}`, message);
    try {
      return await finish(
        deps,
        scan,
        "failed",
        "The scan hit an unexpected error. Try again in a few minutes.",
      );
    } catch {
      return "lost_lease";
    }
  }
}

async function yieldScan(deps: RunnerDeps, scan: ScanRow): Promise<SliceResult> {
  // Expire the lease now so the next claim (cron, or the status watchdog) can resume at once.
  await write(deps, scan, { lease_until: new Date(Date.now() - 1000).toISOString() });
  return "yield";
}

/* ───────────────────────── discover ───────────────────────── */

async function discover(scan: ScanRow, deps: RunnerDeps): Promise<SliceResult | null> {
  await write(deps, scan, { stage: "discovering" });

  // The start URL first: its final URL (after redirects) defines the site.
  const home = await fetchWithRetry(deps.fetcher, scan.url, { timeoutMs: 15_000 });
  if (home.blocked) return finish(deps, scan, "failed", "That URL is not allowed.");
  if (home.error || home.status === null) {
    return finish(
      deps,
      scan,
      "failed",
      `Couldn't reach ${scan.url}: ${home.error ?? "no response"}.`,
    );
  }

  const finalUrl = home.finalUrl ?? scan.url;
  const origin = new URL(finalUrl).origin;
  const host = siteHost(finalUrl);
  const { site, sitemapUrls } = await discoverSiteArtifacts(deps.fetcher, origin);

  const homeHtml = home.ok && isHtmlResponse(home.contentType, home.body);
  if (!homeHtml && scan.mode === "quick") {
    return finish(
      deps,
      scan,
      "failed",
      home.ok
        ? `${finalUrl} did not return an HTML page.`
        : `${finalUrl} returned HTTP ${home.status}.`,
    );
  }

  // Idempotent on re-entry: the homepage row is looked up by URL and only
  // filled while still pending, so a retried slice never overwrites a page.
  const homeUrl = normalizeCrawlUrl(finalUrl, host) ?? finalUrl;

  if (scan.mode === "targeted") {
    // Verification: exactly the requested pages on this site, nothing discovered.
    const targets = [
      ...new Set(
        (scan.config.urls ?? [])
          .map((u) => normalizeCrawlUrl(u, host))
          .filter((u): u is string => !!u),
      ),
    ].slice(0, 20);
    if (!targets.length) {
      return finish(deps, scan, "failed", "None of the pages to verify belong to this site.");
    }
    await deps.store.insertPages(
      scan,
      targets.map((url) => ({ url, depth: 0 })),
    );
    if (targets.includes(homeUrl)) {
      const row = await deps.store.findPage(scan.id, homeUrl);
      if (row?.state === "pending") {
        await deps.store.updatePage(
          row.id,
          await pagePatchFromFetch(home, homeHtml, site, scan, deps),
        );
      }
    }
    const counts = await deps.store.countPages(scan.id);
    await write(deps, scan, {
      stage: "crawling",
      origin,
      host,
      site,
      progress: progressOf(counts, scan),
    });
    return null;
  }

  await deps.store.insertPages(scan, [{ url: homeUrl, depth: 0 }]);
  const homeRow = await deps.store.findPage(scan.id, homeUrl);
  const homePatch = await pagePatchFromFetch(home, homeHtml, site, scan, deps);
  if (homeRow?.state === "pending") await deps.store.updatePage(homeRow.id, homePatch);

  if (scan.mode === "full" && scan.config.maxPages > 1) {
    const homeAnalysis = homePatch.analysis;
    const linkSeeds =
      homeAnalysis && !homeAnalysis.robotsMeta?.nofollow
        ? homeAnalysis.links.internal.map((l) => normalizeCrawlUrl(l.href, host))
        : [];
    const sitemapSeeds = sitemapUrls.map((u) => normalizeCrawlUrl(u, host));
    const seeds = [...linkSeeds, ...sitemapSeeds].filter((u): u is string => !!u && u !== homeUrl);
    await enqueue(
      scan,
      deps,
      seeds.map((url) => ({ url, depth: 1 })),
    );
  }

  const counts = await deps.store.countPages(scan.id);
  await write(deps, scan, {
    stage: "crawling",
    origin,
    host,
    site,
    progress: progressOf(counts, scan),
  });
  return null;
}

/**
 * HTTP analysis first; when the server HTML is a client-rendered shell and
 * rendering is available (and within this scan's allowance), analyse the
 * rendered DOM instead while keeping the raw-HTML measurements crawlers see.
 */
async function analyzeWithRendering(
  body: string,
  url: string,
  meta: { bytes: number; truncated: boolean },
  scan: ScanRow,
  deps: RunnerDeps,
): Promise<PageAnalysis> {
  const http = analyzePage(body, url, meta);
  const decision = needsRendering(body, http);
  if (!decision.render) return http;

  const progress = scan.progress as Record<string, number | undefined>;
  progress.renderNeeded = (progress.renderNeeded ?? 0) + 1;
  const base = { httpWords: http.text.words, markers: decision.markers };
  const allowance =
    scan.config.maxRenders ?? defaultMaxRenders(scan.mode, scan.config.urls?.length);
  if (!deps.render) {
    return {
      ...http,
      rendering: {
        mode: "http",
        reason: deps.renderUnavailableReason ?? "Browser rendering is unavailable.",
        renderedWords: null,
        ...base,
      },
    };
  }
  if ((progress.rendered ?? 0) >= allowance) {
    return {
      ...http,
      rendering: {
        mode: "http",
        reason: "This scan's browser-rendering allowance was used.",
        renderedWords: null,
        ...base,
      },
    };
  }
  progress.rendered = (progress.rendered ?? 0) + 1;
  const result = await deps.render(url);
  if (!result.ok) {
    return {
      ...http,
      rendering: {
        mode: "http",
        reason: `Rendering failed: ${result.error}`,
        renderedWords: null,
        ...base,
      },
    };
  }
  const rendered = analyzePage(result.html, url, {
    bytes: Buffer.byteLength(result.html),
    truncated: false,
  });
  return {
    ...rendered,
    url: http.url,
    // What crawlers download stays measured on the server HTML.
    bytes: http.bytes,
    truncated: http.truncated,
    text: { ...rendered.text, textToHtmlRatio: http.text.textToHtmlRatio },
    rendering: {
      mode: "browser",
      reason: decision.reason,
      renderedWords: rendered.text.words,
      ms: result.ms,
      ...base,
    },
  };
}

async function pagePatchFromFetch(
  res: Awaited<ReturnType<typeof fetchWithRetry>>,
  isHtml: boolean,
  site: SiteArtifacts,
  scan: ScanRow,
  deps: RunnerDeps,
): Promise<Parameters<GeoStore["updatePage"]>[1]> {
  const base = {
    final_url: res.finalUrl,
    status_code: res.status,
    content_type: res.contentType?.slice(0, 120) ?? null,
    fetch_ms: res.ms,
    x_robots_tag: res.xRobotsTag?.slice(0, 200) ?? null,
    fetched_at: nowIso(),
  };
  if (res.error || res.status === null) {
    return { ...base, state: "failed", skip_reason: res.error ?? "No response" };
  }
  if (res.status >= 400) return { ...base, state: "fetched", skip_reason: `HTTP ${res.status}` };
  if (!isHtml) return { ...base, state: "skipped", skip_reason: "Not an HTML page" };
  if (res.finalUrl && siteHost(res.finalUrl) !== site.host) {
    return { ...base, state: "skipped", skip_reason: "Redirects to another site" };
  }
  const analysis = await analyzeWithRendering(
    res.body,
    res.finalUrl ?? "",
    { bytes: res.bytes, truncated: res.truncated },
    scan,
    deps,
  );
  return { ...base, state: "fetched", skip_reason: null, analysis };
}

async function enqueue(
  scan: ScanRow,
  deps: RunnerDeps,
  candidates: { url: string; depth: number }[],
) {
  if (!candidates.length) return;
  const counts = await deps.store.countPages(scan.id);
  const room = scan.config.maxPages - counts.total;
  if (room <= 0) return;
  const unique = new Map<string, number>();
  for (const c of candidates) {
    if (c.depth > scan.config.maxDepth) continue;
    if (!unique.has(c.url)) unique.set(c.url, c.depth);
  }
  const batch = [...unique.entries()].slice(0, room).map(([url, depth]) => ({ url, depth }));
  await deps.store.insertPages(scan, batch);
}

function progressOf(
  c: {
    total: number;
    pending: number;
    fetched: number;
    failed: number;
    skipped: number;
  },
  scan: ScanRow,
) {
  return {
    discovered: c.total,
    pending: c.pending,
    fetched: c.fetched,
    failed: c.failed,
    skipped: c.skipped,
    rendered: scan.progress.rendered ?? 0,
    renderNeeded: scan.progress.renderNeeded ?? 0,
  };
}

/* ───────────────────────── crawl ───────────────────────── */

/** Returns true when the frontier is exhausted (move on), false when out of time. */
async function crawl(scan: ScanRow, deps: RunnerDeps): Promise<boolean> {
  const now = deps.now ?? Date.now;
  const site = scan.site as SiteArtifacts;
  const robots = site.robots?.status === "found" ? site.robots.text : "";
  const delayMs = Math.max(
    MIN_REQUEST_GAP_MS,
    Math.min(2000, (crawlDelayFor(robots, GEO_CRAWLER_TOKEN) ?? 0) * 1000),
  );

  for (;;) {
    if (now() >= deps.deadline - 5_000) return false;

    // Cancellation is checked between batches; the lease is renewed with it.
    const fresh = await deps.store.getScan(scan.id);
    if (fresh?.cancel_requested) {
      await deps.store.skipPending(scan.id, "Scan cancelled");
      await finish(deps, scan, "cancelled", null);
      return true;
    }
    if (!(await deps.store.renewLease(scan.id, deps.worker, LEASE_SECONDS))) {
      throw new LeaseLostError(`Lease on scan ${scan.id} was lost`);
    }

    const batch = await deps.store.nextPending(scan.id, CONCURRENCY);
    if (!batch.length) break;

    const discovered: { url: string; depth: number }[] = [];
    await Promise.all(
      batch.map(async (page, i) => {
        await sleep(i * delayMs);
        const links = await crawlPage(page, scan, site, robots, deps);
        for (const url of links) discovered.push({ url, depth: page.depth + 1 });
      }),
    );
    await enqueue(scan, deps, discovered);

    const counts = await deps.store.countPages(scan.id);
    await write(deps, scan, { progress: progressOf(counts, scan) });
  }

  const counts = await deps.store.countPages(scan.id);
  await write(deps, scan, { stage: "analyzing", progress: progressOf(counts, scan) });
  return true;
}

async function crawlPage(
  page: PageRow,
  scan: ScanRow,
  site: SiteArtifacts,
  robots: string,
  deps: RunnerDeps,
): Promise<string[]> {
  let path = "/";
  try {
    const u = new URL(page.url);
    path = `${u.pathname}${u.search}`;
  } catch {
    await deps.store.updatePage(page.id, { state: "skipped", skip_reason: "Invalid URL" });
    return [];
  }
  if (robots && !isPathAllowed(robots, GEO_CRAWLER_TOKEN, path)) {
    await deps.store.updatePage(page.id, {
      state: "skipped",
      skip_reason: "Disallowed by robots.txt",
    });
    return [];
  }

  const res = await fetchWithRetry(deps.fetcher, page.url);
  const isHtml = res.ok && isHtmlResponse(res.contentType, res.body);
  const patch = await pagePatchFromFetch(res, isHtml, site, scan, deps);
  await deps.store.updatePage(page.id, patch);

  const analysis = patch.analysis;
  if (!analysis || analysis.robotsMeta?.nofollow || page.depth + 1 > scan.config.maxDepth)
    return [];
  return analysis.links.internal
    .map((l) => normalizeCrawlUrl(l.href, site.host))
    .filter((u): u is string => !!u);
}

/* ───────────────────────── analyze ───────────────────────── */

async function analyze(scan: ScanRow, deps: RunnerDeps) {
  await deps.store.skipPending(scan.id, "Page limit reached");
  const rows = await deps.store.loadPages(scan.id);
  const site = scan.site as SiteArtifacts;
  // A targeted scan reads a handful of pages: multi-page rules don't apply.
  const { report, findings, pageScores } = scoreScan(site, rows.map(pageRowToCrawled), {
    mode: scan.mode === "targeted" ? "quick" : scan.mode,
  });
  const renderNeeded = rows.filter((r) => r.analysis?.rendering).length;
  report.rendering = {
    available: Boolean(deps.render),
    reason: deps.render
      ? "Browser rendering available"
      : (deps.renderUnavailableReason ?? "Browser rendering unavailable"),
    rendered: rows.filter((r) => r.analysis?.rendering?.mode === "browser").length,
    needed: renderNeeded,
  };

  if (!report.counts.pagesCrawled) {
    await finish(
      deps,
      scan,
      "failed",
      "No pages could be read — the site may block crawlers, require a login, or return errors.",
    );
    return;
  }

  const idByUrl = new Map<string, string>();
  for (const r of rows) {
    idByUrl.set(r.url, r.id);
    if (r.analysis?.url) idByUrl.set(r.analysis.url, r.id);
  }
  await deps.store.replaceFindings(
    scan,
    findings.map((f) => ({ ...f, pageId: f.pageUrl ? (idByUrl.get(f.pageUrl) ?? null) : null })),
  );

  const issuesByUrl = new Map<string, number>();
  for (const f of findings)
    if (f.pageUrl) issuesByUrl.set(f.pageUrl, (issuesByUrl.get(f.pageUrl) ?? 0) + 1);
  await deps.store.updatePageScores(
    rows
      .filter((r) => r.analysis && pageScores.has(r.analysis.url))
      .map((r) => {
        const s = pageScores.get(r.analysis!.url)!;
        return {
          id: r.id,
          score: s.score,
          categoryScores: s.categories as Record<string, number>,
          issues: issuesByUrl.get(r.analysis!.url) ?? 0,
        };
      }),
  );

  const targeted = scan.mode === "targeted";
  // Verification scans aren't part of the site's score history.
  const previous = targeted
    ? null
    : await deps.store.findPreviousScan(scan.workspace_id, scan.host, scan.created_at, scan.id);
  const categoryScores = Object.fromEntries(report.categories.map((c) => [c.id, c.score]));
  const counts = await deps.store.countPages(scan.id);
  const { pageScores: _omit, ...storedReport } = report;
  const probing = !targeted && scan.config.probes && deps.probes;

  await write(deps, scan, {
    overall_score: report.overall,
    category_scores: categoryScores,
    report: storedReport,
    previous_scan_id: previous,
    progress: progressOf(counts, scan),
    stage: probing ? "probing" : "done",
    ...(probing ? {} : { status: "succeeded" as const, completed_at: nowIso(), lease_until: null }),
  });

  if (!targeted)
    await deps.store.reopenRegressed?.(
      scan.workspace_id,
      findings.map((f) => f.fingerprint),
    );
  if (targeted) return;

  // Analytics, Coach and suggestions read the score history from geo_audit_runs.
  try {
    await deps.store.recordAuditRun({
      workspace_id: scan.workspace_id,
      url: site.origin,
      score: report.overall,
      subscores: categoryScores,
      created_by: scan.created_by,
      meta: {
        scanId: scan.id,
        mode: scan.mode,
        fetchedAt: Date.now(),
        pages: report.counts.pagesCrawled,
        actionsCount: report.actions.length,
        actions: report.actions.slice(0, 8).map((a) => ({
          id: a.ruleId,
          priority: actionPriorityLegacy(a.priority),
          title: a.title,
          detail: a.detail,
        })),
      },
    });
  } catch (error) {
    deps.log?.(`[geo] audit history not recorded for scan ${scan.id}`, error);
  }
}

/* ───────────────────────── probe (flagged) ───────────────────────── */

async function probe(scan: ScanRow, deps: RunnerDeps) {
  const site = scan.site as SiteArtifacts;
  let result: unknown = null;
  if (deps.probes) {
    try {
      const rows = await deps.store.loadPages(scan.id);
      const home =
        rows.find((r) => r.analysis?.pageType === "home")?.analysis ?? rows[0]?.analysis ?? null;
      const topics = [
        ...new Set(
          rows
            .map((r) => r.analysis?.topic.primary)
            .filter((t): t is string => !!t && t.length > 3),
        ),
      ].slice(0, 5);
      result = await deps.probes(scan, {
        site,
        brandName: home?.trust.siteName ?? home?.schema.organizations[0]?.name ?? null,
        topics,
        pageUrls: rows.map((r) => r.final_url ?? r.url),
      });
    } catch (error) {
      // Probes are optional enrichment: their failure never fails the scan.
      result = { error: error instanceof Error ? error.message : "AI answer checks failed" };
    }
  }
  await write(deps, scan, {
    probes: result,
    stage: "done",
    status: "succeeded",
    completed_at: nowIso(),
    lease_until: null,
  });
}
