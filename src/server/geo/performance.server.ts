// performance.server.ts — the network half of AI Visibility speed measurement.
//
// Two free Google APIs under Mellox's own key (never a customer's):
//   PageSpeed Insights v5  Lighthouse lab runs on a few route-sampled pages
//   Chrome UX Report       real-user p75s for the origin, and its weekly history
// This is the only file that talks to either API or reads their key. The key
// travels in the `x-goog-api-key` header, never in a URL or a log. The page
// URL sent to Google is one Mellox already crawled, so it has passed the SSRF
// guard (`assertPublicUrl`) when the scan was created.
import "server-only";
import { isGeoPerformanceEnabled } from "@/lib/feature-flags";
import { parseCruxHistory, parseCruxRecord, parsePsi } from "@/lib/geo/performance";
import type { FieldHistory, FieldVitals, LabRun } from "@/lib/geo/types";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const CRUX_ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records";

export type PerformanceMeter = {
  /** Real-user data for the origin; `reason` explains an empty result. */
  field(
    origin: string,
  ): Promise<{ origin: FieldVitals | null; history: FieldHistory | null; reason: string | null }>;
  /** One Lighthouse run (mobile) through PageSpeed Insights. Never throws. */
  lab(url: string, group: string, timeoutMs: number): Promise<LabRun>;
};

function apiKey(): string | null {
  return process.env.GOOGLE_PAGESPEED_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
}

/** Lab pages per full scan (PageSpeed quota is per key, so it is kept small). */
export function labPagesPerScan(): number {
  const n = Number(process.env.GEO_LAB_PAGES ?? 4);
  return Number.isFinite(n) ? Math.max(0, Math.min(10, Math.floor(n))) : 4;
}

export function performanceAvailability(workspaceId: string): {
  available: boolean;
  reason: string | null;
} {
  if (!isGeoPerformanceEnabled(workspaceId)) {
    return { available: false, reason: "Speed checks are turned off." };
  }
  return { available: true, reason: null };
}

function headers(json: boolean): Record<string, string> {
  const key = apiKey();
  return {
    accept: "application/json",
    ...(json ? { "content-type": "application/json" } : {}),
    ...(key ? { "x-goog-api-key": key } : {}),
  };
}

async function crux(path: "queryRecord" | "queryHistoryRecord", origin: string) {
  const res = await fetch(`${CRUX_ENDPOINT}:${path}`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ origin, formFactor: "PHONE" }),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  // 404: Chrome has too little traffic data for this site — a fact, not an error.
  if (res.status === 404) return { status: 404 as const, json: null };
  if (!res.ok) return { status: res.status, json: null };
  return { status: res.status, json: (await res.json()) as unknown };
}

export function createPerformanceMeter(): PerformanceMeter {
  return {
    async field(origin) {
      if (!apiKey()) return { origin: null, history: null, reason: "Real-user data isn't set up." };
      try {
        const [current, history] = await Promise.all([
          crux("queryRecord", origin),
          crux("queryHistoryRecord", origin),
        ]);
        const vitals = parseCruxRecord(current.json, "origin");
        const series = parseCruxHistory(history.json);
        const reason = vitals
          ? null
          : current.status === 404
            ? "Chrome doesn't have enough real-user visits to this site yet."
            : `Real-user data couldn't be read (HTTP ${current.status}).`;
        return { origin: vitals, history: series, reason };
      } catch (error) {
        return {
          origin: null,
          history: null,
          reason:
            error instanceof Error && error.name === "TimeoutError"
              ? "Real-user data timed out."
              : "Real-user data couldn't be read.",
        };
      }
    },

    async lab(url, group, timeoutMs) {
      const params = new URLSearchParams({ url, strategy: "mobile" });
      for (const c of ["performance", "accessibility", "best-practices", "seo"]) {
        params.append("category", c);
      }
      try {
        const res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
          headers: headers(false),
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
        if (!res.ok) {
          const reason =
            res.status === 429
              ? "Speed test quota reached; try again later."
              : res.status === 400 || res.status === 500
                ? "Lighthouse couldn't load this page."
                : `Speed test failed (HTTP ${res.status}).`;
          return { url, group, ok: false, error: reason };
        }
        return parsePsi(await res.json(), url, group);
      } catch (error) {
        return {
          url,
          group,
          ok: false,
          error:
            error instanceof Error && error.name === "TimeoutError"
              ? "The speed test timed out."
              : "The speed test failed.",
        };
      }
    },
  };
}
