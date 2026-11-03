"use client";

// Development-only: the AI Visibility speed card and the "since your fixes went
// live" card with sample data, so layout and copy can be checked without a
// workspace, a sign-in or a scan. Mounted at /geo-lab.
import type { FixImpact } from "@/lib/geo/fix-impact";
import type { SitePerformance } from "@/lib/geo/types";
import { FixImpactView } from "./FixImpactCard";
import { PerformanceView } from "./PerformanceCard";

const MEASURED: SitePerformance = {
  measuredAt: "2026-10-28T10:00:00Z",
  unavailable: null,
  field: {
    origin: {
      scope: "origin",
      key: "https://acme.io",
      lcp: { p75: 3120, rating: "needs_improvement" },
      inp: { p75: 140, rating: "good" },
      cls: { p75: 0.31, rating: "poor" },
      fcp: { p75: 1900, rating: "needs_improvement" },
      ttfb: { p75: 700, rating: "good" },
      periodEnd: "2026-10-26",
    },
    history: null,
  },
  sample: [
    "https://acme.io/",
    "https://acme.io/blog/how-to-get-paid-on-time",
    "https://acme.io/pricing",
    "https://acme.io/docs/getting-started",
  ],
  lab: [
    {
      url: "https://acme.io/",
      group: "/",
      ok: true,
      scores: { performance: 54, accessibility: 92, bestPractices: 100, seo: 91 },
      opportunities: [
        {
          id: "render-blocking-resources",
          title: "Eliminate render-blocking resources",
          savingsMs: 1350,
        },
      ],
    },
    {
      url: "https://acme.io/blog/how-to-get-paid-on-time",
      group: "/blog/:slug",
      ok: true,
      scores: { performance: 91, accessibility: 100, bestPractices: 96, seo: 100 },
      opportunities: [],
    },
    {
      url: "https://acme.io/pricing",
      group: "/pricing",
      ok: true,
      scores: { performance: 38, accessibility: 81, bestPractices: 78, seo: 83 },
      opportunities: [
        { id: "uses-optimized-images", title: "Efficiently encode images", savingsMs: 2400 },
      ],
    },
    {
      url: "https://acme.io/docs/getting-started",
      group: "/docs/:slug",
      ok: false,
      error: "Speed test quota reached; try again later.",
    },
  ],
};

const NO_FIELD: SitePerformance = {
  ...MEASURED,
  unavailable: "Chrome doesn't have enough real-user visits to this site yet.",
  field: { origin: null, history: null },
  lab: MEASURED.lab.slice(0, 2),
};

const IMPACT: FixImpact = {
  firstFixAt: "2026-08-02T09:00:00Z",
  fixes: { live: 6, verified: 4, checking: 1, notFixed: 1 },
  score: {
    before: 61,
    after: 78,
    beforeAt: "2026-07-30T00:00:00Z",
    afterAt: "2026-10-27T00:00:00Z",
  },
  mentions: { before: 0.12, after: 0.27, checksBefore: 24, checksAfter: 30 },
  position: null,
  waiting: { scan: false, checks: false },
  speed: [
    { metric: "lcp", before: 4100, after: 2650, change: -0.354, improved: true },
    { metric: "cls", before: 0.08, after: 0.12, change: 0.5, improved: false },
  ],
};

export function GeoLab() {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 sm:p-8">
      <h1 className="text-[18px] font-semibold">AI Visibility lab</h1>
      <div className="flex flex-col gap-2">
        <h2 className="text-[13px] font-medium text-muted-foreground">Speed — measured</h2>
        <PerformanceView performance={MEASURED} />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-[13px] font-medium text-muted-foreground">Speed — no real-user data</h2>
        <PerformanceView performance={NO_FIELD} />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-[13px] font-medium text-muted-foreground">
          Since your fixes went live
        </h2>
        <FixImpactView impact={IMPACT} />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-[13px] font-medium text-muted-foreground">
          Since fixes — speed still settling
        </h2>
        <FixImpactView impact={{ ...IMPACT, speed: [] }} />
      </div>
    </div>
  );
}
