// render.server.ts — controlled browser rendering for client-rendered pages.
//
// HTTP first: the scan worker only renders a page when rendering.ts decides its
// server HTML is an empty app shell. Then a headless Chromium loads the page
// with every network request fulfilled by Mellox's SSRF-guarded fetcher:
//
//   • Chromium resolves no hostnames itself (--host-resolver-rules maps all to
//     NOTFOUND); requests only succeed when page.route fulfils them
//   • only GET; images, media, fonts, websockets, event streams and service
//     workers are refused; downloads are disabled
//   • per page: ≤ 80 requests, ≤ 8 MB fetched, 20 s wall clock
//   • one render at a time per process; the browser closes when idle
//
// Availability: FEATURE_FLAG_GEO_RENDERING_ENABLED plus a browser from
// GEO_RENDER_WS_ENDPOINT (remote CDP), GEO_RENDER_EXECUTABLE, or Playwright's
// installed Chromium in development. Nothing is guessed when it's unavailable.
import "server-only";
import { existsSync } from "node:fs";
import type { Browser, Route } from "playwright-core";
import { SsrfBlockedError } from "@/server/safe-fetch";
import { geoUserAgent, type Fetcher } from "./crawler.server";

export type RenderOutcome =
  | { ok: true; html: string; finalUrl: string; ms: number; requests: number; refused: number }
  | { ok: false; error: string };

export type Renderer = (url: string) => Promise<RenderOutcome>;

const MAX_REQUESTS = 80;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 20_000;
const IDLE_CLOSE_MS = 60_000;
const REFUSED_TYPES = new Set([
  "image",
  "media",
  "font",
  "texttrack",
  "websocket",
  "eventsource",
  "manifest",
  "ping",
]);

const truthy = (v: string | undefined) => /^(1|true|yes)$/i.test((v ?? "").trim());

export type RenderingAvailability = { available: boolean; reason: string };

let resolvedExecutable: string | null | undefined;

async function localExecutable(): Promise<string | null> {
  if (resolvedExecutable !== undefined) return resolvedExecutable;
  const configured = process.env.GEO_RENDER_EXECUTABLE?.trim();
  if (configured) {
    resolvedExecutable = existsSync(configured) ? configured : null;
    return resolvedExecutable;
  }
  try {
    const { chromium } = await import("playwright-core");
    const path = chromium.executablePath();
    resolvedExecutable = path && existsSync(path) ? path : null;
  } catch {
    resolvedExecutable = null;
  }
  return resolvedExecutable;
}

export async function getRenderingAvailability(): Promise<RenderingAvailability> {
  if (!truthy(process.env.FEATURE_FLAG_GEO_RENDERING_ENABLED)) {
    return { available: false, reason: "Browser rendering is turned off on this server." };
  }
  if (process.env.GEO_RENDER_WS_ENDPOINT?.trim())
    return { available: true, reason: "Remote browser" };
  return (await localExecutable())
    ? { available: true, reason: "Local Chromium" }
    : { available: false, reason: "No Chromium is installed for browser rendering." };
}

/* ───────────────────────── browser lifecycle ───────────────────────── */

let browserPromise: Promise<Browser> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function getBrowser(): Promise<Browser> {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const { chromium } = await import("playwright-core");
    const endpoint = process.env.GEO_RENDER_WS_ENDPOINT?.trim();
    if (endpoint) return chromium.connectOverCDP(endpoint, { timeout: 15_000 });
    const executablePath = await localExecutable();
    if (!executablePath) throw new Error("No Chromium available");
    return chromium.launch({
      executablePath,
      headless: true,
      chromiumSandbox: !truthy(process.env.GEO_RENDER_NO_SANDBOX),
      args: [
        "--host-resolver-rules=MAP * ~NOTFOUND",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--no-first-run",
        "--mute-audio",
      ],
    });
  })();
  browserPromise.then(
    (b) => b.on("disconnected", () => (browserPromise = null)),
    () => (browserPromise = null),
  );
  return browserPromise;
}

function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const p = browserPromise;
    browserPromise = null;
    void p?.then((b) => b.close()).catch(() => {});
  }, IDLE_CLOSE_MS);
  idleTimer.unref?.();
}

/* ───────────────────────── render one page ───────────────────────── */

async function renderOnce(url: string, fetcher: Fetcher): Promise<RenderOutcome> {
  const started = Date.now();
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: geoUserAgent(),
    viewport: { width: 1280, height: 900 },
    serviceWorkers: "block",
    acceptDownloads: false,
    javaScriptEnabled: true,
    locale: "en-US",
  });
  let requests = 0;
  let refused = 0;
  let bytes = 0;
  try {
    await context.route("**/*", async (route: Route) => {
      const request = route.request();
      const target = request.url();
      if (
        request.method() !== "GET" ||
        REFUSED_TYPES.has(request.resourceType()) ||
        !/^https?:\/\//i.test(target) ||
        requests >= MAX_REQUESTS ||
        bytes >= MAX_TOTAL_BYTES
      ) {
        refused++;
        return route.abort("blockedbyclient");
      }
      requests++;
      try {
        const res = await fetcher(target, {
          headers: {
            "user-agent": geoUserAgent(),
            accept: request.headers()["accept"] ?? "*/*",
          },
          timeoutMs: 8_000,
          maxBytes: Math.min(3 * 1024 * 1024, MAX_TOTAL_BYTES - bytes),
          onOverflow: "truncate",
        });
        bytes += res.bytes.byteLength;
        const contentType = res.headers.get("content-type") ?? "application/octet-stream";
        return route.fulfill({
          status: res.status,
          headers: { "content-type": contentType },
          body: Buffer.from(res.bytes),
        });
      } catch (error) {
        refused++;
        const cause = (error as { cause?: unknown })?.cause;
        return route.abort(
          error instanceof SsrfBlockedError || cause instanceof SsrfBlockedError
            ? "blockedbyclient"
            : "failed",
        );
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT_MS,
    });
    if (!response) return { ok: false, error: "The page didn't load in the browser." };
    // Client apps render after their bundles run; give the network a moment to settle.
    await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
    const html = await page.content();
    return { ok: true, html, finalUrl: page.url(), ms: Date.now() - started, requests, refused };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 200) : "Rendering failed",
    };
  } finally {
    await context.close().catch(() => {});
    scheduleIdleClose();
  }
}

/** A renderer bound to the scan's guarded fetcher; renders one page at a time. */
export function createRenderer(fetcher: Fetcher): Renderer {
  return (url) => {
    const run = queue.then(() => renderOnce(url, fetcher));
    queue = run.catch(() => {});
    return run.catch((error) => ({
      ok: false as const,
      error: error instanceof Error ? error.message.slice(0, 200) : "Rendering failed",
    }));
  };
}
