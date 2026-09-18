import { describe, expect, it } from "vitest";
import { buildChatContext } from "@/lib/analytics/chat-context";
import { compareMetric } from "@/lib/analytics/compare";
import { groundInsights } from "@/lib/analytics/grounding";
import { buildSignals } from "@/lib/analytics/signals";
import type { OverviewReport, SourceStatus } from "@/lib/analytics/types";
import type { GoogleApi, GscQueryRequest, Ga4ReportRequest } from "./google/api.server";
import { assertPropertyId, assertSiteUrl, siteHostOf } from "./google/api.server";
import { checkGoogleConfig } from "./google/config.server";
import { classifyGoogleFailure, GoogleApiError } from "./google/errors";
import { buildAuthUrl, identityFromIdToken, scopeFlags } from "./google/oauth.server";
import { advanceRun, runProgress } from "./sync/runner.server";
import { syncWindow } from "./sync/service.server";
import { MemoryAnalyticsStore } from "./sync/store.memory";
import type { SourceRow } from "./sync/store";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "22222222-2222-4222-8222-222222222222";
const KEY = Buffer.alloc(32, 7).toString("base64");

function source(kind: SourceRow["kind"], overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    id: `src-${kind}`,
    workspace_id: WS,
    connection_id: "conn-1",
    kind,
    external_id: kind === "ga4_property" ? "properties/123" : "sc-domain:example.com",
    display_name: "Example",
    account_name: null,
    site_host: "example.com",
    time_zone: kind === "ga4_property" ? "UTC" : "America/Los_Angeles",
    currency: null,
    status: "active",
    last_error: null,
    backfill_completed_at: null,
    last_synced_at: null,
    last_synced_date: null,
    selected_by: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function eachDate(from: string, to: string) {
  const out: string[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d.toISOString().slice(0, 10) <= to;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    out.push(d.toISOString().slice(0, 10));
  return out;
}

type Calls = { ga4: Ga4ReportRequest[]; gsc: GscQueryRequest[] };

function fakeApi(
  opts: { failOn?: (call: number) => GoogleApiError | null } = {},
): GoogleApi & { calls: Calls } {
  const calls: Calls = { ga4: [], gsc: [] };
  let n = 0;
  const maybeFail = () => {
    n += 1;
    const err = opts.failOn?.(n);
    if (err) throw err;
  };
  return {
    calls,
    async listGa4Properties() {
      return [];
    },
    async getGa4Property(id) {
      return { propertyId: id, displayName: "Example", timeZone: "UTC", currencyCode: "USD" };
    },
    async runGa4Report(_id, req) {
      maybeFail();
      calls.ga4.push(req);
      if (req.dimensions.length === 0)
        return {
          rows: [{ dimensions: [], metrics: [42] }],
          rowCount: 1,
          tokensRemainingToday: 1000,
        };
      const days = eachDate(req.startDate, req.endDate);
      if (req.dimensions.length === 1) {
        return {
          rows: days.map((d) => ({
            dimensions: [d.replace(/-/g, "")],
            metrics: [100, 80, 20, 60, 300, 5, 90, 0.4],
          })),
          rowCount: days.length,
          tokensRemainingToday: 1000,
        };
      }
      return {
        rows: days.flatMap((d) => [
          { dimensions: [d.replace(/-/g, ""), "Organic Search"], metrics: [70, 60, 200, 3] },
          { dimensions: [d.replace(/-/g, ""), "Direct"], metrics: [30, 25, 100, 2] },
        ]),
        rowCount: days.length * 2,
        tokensRemainingToday: 1000,
      };
    },
    async listGscSites() {
      return [];
    },
    async queryGsc(_site, req) {
      maybeFail();
      calls.gsc.push(req);
      const days = eachDate(req.startDate, req.endDate);
      if (req.dimensions.length === 1)
        return days.map((d) => ({
          keys: [d],
          clicks: 10,
          impressions: 200,
          ctr: 0.05,
          position: 8,
        }));
      if ((req.startRow ?? 0) > 0) return [];
      return days.flatMap((d) => [
        { keys: [d, "mellox"], clicks: 6, impressions: 50, ctr: 0.12, position: 2 },
        { keys: [d, "ai marketing"], clicks: 4, impressions: 150, ctr: 0.03, position: 12 },
      ]);
    },
  };
}

function setup(
  kind: SourceRow["kind"],
  api: GoogleApi,
  clock = () => Date.parse("2026-09-18T12:00:00Z"),
) {
  const store = new MemoryAnalyticsStore(clock);
  const src = source(kind);
  store.sources.set(src.id, src);
  store.connections.set("conn-1", { id: "conn-1", workspace_id: WS, status: "active" });
  return { store, src, deps: { store, apiFor: () => api, worker: "w1", now: clock } };
}

describe("sync windows", () => {
  it("backfills 180 days first, then refreshes the last 4 days", () => {
    const now = new Date("2026-09-18T12:00:00Z");
    expect(syncWindow(source("ga4_property"), "daily", now)).toEqual({
      trigger: "initial",
      range_start: "2026-03-22",
      range_end: "2026-09-17",
    });
    expect(
      syncWindow(
        source("ga4_property", { backfill_completed_at: "2026-09-01T00:00:00Z" }),
        "manual",
        now,
      ),
    ).toEqual({ trigger: "manual", range_start: "2026-09-14", range_end: "2026-09-17" });
  });

  it("uses Pacific Time for Search Console", () => {
    const early = new Date("2026-09-18T03:00:00Z"); // still Sep 17 in Los Angeles
    expect(
      syncWindow(source("gsc_site", { backfill_completed_at: "x" }), "daily", early).range_end,
    ).toBe("2026-09-16");
  });
});

describe("sync runner", () => {
  it("backfills GA4 in chunks, caches preset user totals and marks the source synced", async () => {
    const api = fakeApi();
    const { store, src, deps } = setup("ga4_property", api);
    const { run } = await store.enqueueRun({
      workspace_id: WS,
      source_id: src.id,
      trigger: "initial",
      range_start: "2026-03-22",
      range_end: "2026-09-17",
    });
    const [claimed] = await store.claimRuns("w1", 1, 150);
    const result = await advanceRun(claimed, { ...deps, deadline: Date.now() + 60_000 });
    expect(result).toBe("done");
    expect(store.ga4Daily.size).toBe(180);
    const row = store.ga4Daily.get(`${src.id}|2026-09-17`)!;
    expect(row).toMatchObject({
      sessions: 100,
      total_users: 80,
      key_events: 5,
      session_duration_seconds: 9000,
      bounced_sessions: 40,
    });
    expect([...store.dims.values()].filter((d) => d.dimension === "channel")).toHaveLength(360);
    // 6 chunks × (totals + 5 breakdowns) + 6 preset user windows.
    expect(api.calls.ga4).toHaveLength(6 * 6 + 6);
    expect(store.periodTotals.get(`${src.id}|2026-08-21|2026-09-17`)?.total_users).toBe(42);
    const done = store.runs.get(run.id)!;
    expect(done.status).toBe("succeeded");
    expect(runProgress(done)).toBe(1);
    expect(store.sources.get(src.id)).toMatchObject({
      last_synced_date: "2026-09-17",
      status: "active",
    });
    expect(store.sources.get(src.id)?.backfill_completed_at).toBeTruthy();
  });

  it("stores Search Console totals with impression-weighted position", async () => {
    const api = fakeApi();
    const { store, src, deps } = setup("gsc_site", api);
    await store.enqueueRun({
      workspace_id: WS,
      source_id: src.id,
      trigger: "daily",
      range_start: "2026-09-13",
      range_end: "2026-09-17",
    });
    const [claimed] = await store.claimRuns("w1", 1, 150);
    expect(await advanceRun(claimed, { ...deps, deadline: Date.now() + 60_000 })).toBe("done");
    expect(store.gscDaily.get(`${src.id}|2026-09-15`)).toMatchObject({
      clicks: 10,
      impressions: 200,
      position_weighted: 1600,
    });
    const queries = [...store.dims.values()].filter((d) => d.dimension === "query");
    expect(queries).toHaveLength(10);
    expect(api.calls.gsc.every((c) => c.dimensions[0] === "date")).toBe(true);
  });

  it("yields at the deadline and resumes from the saved cursor", async () => {
    let t = Date.parse("2026-09-18T12:00:00Z");
    const clock = () => t;
    const api = fakeApi({
      failOn: () => {
        t += 10_000;
        return null;
      },
    });
    const { store, src, deps } = setup("ga4_property", api, clock);
    const { run } = await store.enqueueRun({
      workspace_id: WS,
      source_id: src.id,
      trigger: "initial",
      range_start: "2026-03-22",
      range_end: "2026-09-17",
    });
    const [first] = await store.claimRuns("w1", 1, 150);
    expect(await advanceRun(first, { ...deps, deadline: t + 25_000 })).toBe("yield");
    const paused = store.runs.get(run.id)!;
    expect(paused.cursor_step + (paused.cursor_date > "2026-03-22" ? 6 : 0)).toBeGreaterThan(0);
    t += 1000;
    const [second] = await store.claimRuns("w2", 1, 150);
    expect(second.id).toBe(run.id);
    expect(await advanceRun(second, { ...deps, worker: "w2", deadline: t + 10_000_000 })).toBe(
      "done",
    );
    expect(store.ga4Daily.size).toBe(180);
  });

  it("backs off on quota and fails on expired access", async () => {
    const quota = fakeApi({
      failOn: (n) =>
        n === 2 ? new GoogleApiError("quota", "quota", { retryAfterSeconds: 60 }) : null,
    });
    const q = setup("gsc_site", quota);
    const { run } = await q.store.enqueueRun({
      workspace_id: WS,
      source_id: q.src.id,
      trigger: "daily",
      range_start: "2026-09-13",
      range_end: "2026-09-17",
    });
    const [claimed] = await q.store.claimRuns("w1", 1, 150);
    expect(await advanceRun(claimed, { ...q.deps, deadline: Date.now() + 60_000 })).toBe("retry");
    const waiting = q.store.runs.get(run.id)!;
    expect(waiting).toMatchObject({
      status: "running",
      failures: 1,
      error_code: "quota",
      cursor_step: 1,
    });
    expect(Date.parse(waiting.next_attempt_at)).toBeGreaterThanOrEqual(
      Date.parse("2026-09-18T12:05:00Z"),
    );
    // Not claimable until the backoff passes.
    expect(await q.store.claimRuns("w1", 1, 150)).toHaveLength(0);

    const expired = fakeApi({ failOn: () => new GoogleApiError("token_expired", "expired") });
    const e = setup("ga4_property", expired);
    await e.store.enqueueRun({
      workspace_id: WS,
      source_id: e.src.id,
      trigger: "daily",
      range_start: "2026-09-13",
      range_end: "2026-09-17",
    });
    const [c2] = await e.store.claimRuns("w1", 1, 150);
    expect(await advanceRun(c2, { ...e.deps, deadline: Date.now() + 60_000 })).toBe("failed");
    expect([...e.store.runs.values()][0]).toMatchObject({
      status: "failed",
      error_code: "token_expired",
    });
  });

  it("marks the source access_lost on permission errors", async () => {
    const api = fakeApi({ failOn: () => new GoogleApiError("permission_denied", "no") });
    const { store, src, deps } = setup("ga4_property", api);
    await store.enqueueRun({
      workspace_id: WS,
      source_id: src.id,
      trigger: "daily",
      range_start: "2026-09-13",
      range_end: "2026-09-17",
    });
    const [claimed] = await store.claimRuns("w1", 1, 150);
    expect(await advanceRun(claimed, { ...deps, deadline: Date.now() + 60_000 })).toBe("failed");
    expect(store.sources.get(src.id)?.status).toBe("access_lost");
  });

  it("refuses a run whose source belongs to another workspace", async () => {
    const api = fakeApi();
    const { store, src, deps } = setup("ga4_property", api);
    await store.enqueueRun({
      workspace_id: WS,
      source_id: src.id,
      trigger: "daily",
      range_start: "2026-09-13",
      range_end: "2026-09-17",
    });
    store.sources.set(src.id, { ...src, workspace_id: OTHER_WS });
    const [claimed] = await store.claimRuns("w1", 1, 150);
    expect(await advanceRun(claimed, { ...deps, deadline: Date.now() + 60_000 })).toBe("failed");
    expect(api.calls.ga4).toHaveLength(0);
  });

  it("keeps one queued/running run per source", async () => {
    const store = new MemoryAnalyticsStore();
    const a = await store.enqueueRun({
      workspace_id: WS,
      source_id: "s",
      trigger: "manual",
      range_start: "2026-09-13",
      range_end: "2026-09-17",
    });
    const b = await store.enqueueRun({
      workspace_id: WS,
      source_id: "s",
      trigger: "manual",
      range_start: "2026-09-13",
      range_end: "2026-09-17",
    });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.run.id).toBe(a.run.id);
  });

  it("stops writing when another worker holds the lease", async () => {
    const api = fakeApi();
    const { store, src, deps } = setup("gsc_site", api);
    await store.enqueueRun({
      workspace_id: WS,
      source_id: src.id,
      trigger: "daily",
      range_start: "2026-09-13",
      range_end: "2026-09-17",
    });
    const [claimed] = await store.claimRuns("w1", 1, 150);
    store.runs.set(claimed.id, { ...store.runs.get(claimed.id)!, locked_by: "someone-else" });
    expect(await advanceRun(claimed, { ...deps, deadline: Date.now() + 60_000 })).toBe(
      "lost_lease",
    );
  });
});

describe("Google API helpers", () => {
  it("classifies failures", () => {
    expect(classifyGoogleFailure(401, {}, "Data").code).toBe("token_expired");
    expect(
      classifyGoogleFailure(429, { error: { status: "RESOURCE_EXHAUSTED" } }, "Data").code,
    ).toBe("quota");
    expect(
      classifyGoogleFailure(403, { error: { message: "Quota exceeded for quota metric" } }, "GSC")
        .code,
    ).toBe("quota");
    expect(
      classifyGoogleFailure(
        403,
        { error: { status: "PERMISSION_DENIED", message: "no access" } },
        "Data",
      ).code,
    ).toBe("permission_denied");
    expect(
      classifyGoogleFailure(
        403,
        {
          error: {
            message:
              "Google Analytics Data API has not been used in project 1 before or it is disabled",
          },
        },
        "Data",
      ).code,
    ).toBe("config");
    expect(classifyGoogleFailure(404, {}, "Admin").code).toBe("not_found");
    expect(classifyGoogleFailure(503, {}, "Admin").retryable).toBe(true);
  });

  it("validates property ids and Search Console sites", () => {
    expect(assertPropertyId("properties/123")).toBe("properties/123");
    expect(() => assertPropertyId("properties/../x")).toThrow();
    expect(assertSiteUrl("sc-domain:example.com")).toBe("sc-domain:example.com");
    expect(assertSiteUrl("https://www.example.com/")).toBe("https://www.example.com/");
    expect(() => assertSiteUrl("javascript:alert(1)")).toThrow();
    expect(() => assertSiteUrl("https://user:pw@example.com/")).toThrow();
    expect(siteHostOf("https://www.Example.com/blog/")).toBe("example.com");
    expect(siteHostOf("sc-domain:example.com")).toBe("example.com");
  });
});

describe("Google OAuth helpers", () => {
  const env = {
    GOOGLE_ANALYTICS_CLIENT_ID: "123-abc.apps.googleusercontent.com",
    GOOGLE_ANALYTICS_CLIENT_SECRET: "secret",
    GOOGLE_TOKEN_ENCRYPTION_KEY: KEY,
    APP_URL: "https://app.mellox.ai",
  };

  it("checks configuration and derives the redirect URI", () => {
    const ok = checkGoogleConfig(env);
    expect(ok.ok && ok.config.redirectUri).toBe(
      "https://app.mellox.ai/api/integrations/google/callback",
    );
    const bad = checkGoogleConfig({
      ...env,
      GOOGLE_TOKEN_ENCRYPTION_KEY: "short",
      GOOGLE_ANALYTICS_CLIENT_ID: "x",
    });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.issues.length).toBe(2);
  });

  it("builds an offline, PKCE-protected, read-only consent URL", () => {
    const check = checkGoogleConfig(env);
    if (!check.ok) throw new Error("config");
    const url = new URL(buildAuthUrl(check.config, "s".repeat(43), "challenge"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("analytics.readonly");
    expect(url.searchParams.get("scope")).toContain("webmasters.readonly");
    expect(url.searchParams.get("scope")).not.toMatch(/analytics(\s|$)|webmasters(\s|$)|edit/);
  });

  it("reads identity claims and granted scopes", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "1234567890", email: "a@b.co" })).toString(
      "base64url",
    );
    expect(identityFromIdToken(`h.${payload}.s`)).toEqual({ sub: "1234567890", email: "a@b.co" });
    expect(identityFromIdToken("garbage")).toBeNull();
    expect(scopeFlags(["https://www.googleapis.com/auth/analytics.readonly"])).toEqual({
      analytics: true,
      searchConsole: false,
    });
  });
});

describe("insight grounding", () => {
  const signals = buildSignals({
    metrics: {
      "gsc.clicks": compareMetric("gsc.clicks", 170, 100),
      "ga4.sessions": compareMetric("ga4.sessions", 900, 1500),
    },
  });

  it("keeps grounded single-source insights and drops the rest", () => {
    const items = groundInsights(
      [
        {
          title: "Google clicks are up",
          summary: "More people clicked your results.",
          source: "gsc",
          signalIds: ["metric:gsc.clicks"],
          severity: "positive",
          recommendation: "Keep refreshing your top pages.",
        },
        {
          title: "Blend",
          summary: "Visits and clicks together rose.",
          source: "gsc",
          signalIds: ["metric:gsc.clicks", "metric:ga4.sessions"],
          severity: "watch",
          recommendation: "Look at both reports together.",
        },
        {
          title: "Invented",
          summary: "Clicks rose 900% this week.",
          source: "gsc",
          signalIds: ["metric:gsc.clicks"],
          severity: "positive",
          recommendation: "Celebrate the growth.",
        },
        {
          title: "Unknown",
          summary: "Something about nothing.",
          source: "ga4",
          signalIds: ["metric:ga4.nope"],
          severity: "watch",
          recommendation: "Do something useful.",
        },
        {
          title: "Visits fell",
          summary: "Visits went from 1,500 to 900.",
          source: "ga4",
          signalIds: ["metric:ga4.sessions"],
          severity: "negative",
          recommendation: "Check your top landing pages.",
        },
      ],
      signals,
    );
    expect(items.map((i) => i.title)).toEqual(["Google clicks are up", "Visits fell"]);
  });
});

describe("chat context", () => {
  it("labels every source separately and reports missing connections", () => {
    const notConnected: SourceStatus = {
      state: "not_connected",
      source: null,
      firstDate: null,
      lastDate: null,
      message: null,
    };
    const report: OverviewReport = {
      mellox: {
        source: "mellox",
        window: {
          current: { from: "2026-08-21", to: "2026-09-17", days: 28 },
          previous: { from: "2026-07-24", to: "2026-08-20", days: 28 },
          previousCovered: true,
          key: "28d:2026-09-17",
          label: "Last 28 days",
        },
        kpis: [
          {
            key: "mellox.published",
            value: 12,
            comparison: compareMetric("mellox.published", 12, 6),
          },
        ],
      },
      website: { status: notConnected, window: null, kpis: [], series: [] },
      search: { status: { ...notConnected, state: "syncing" }, window: null, kpis: [], series: [] },
      aiVisibility: {
        latest: null,
        kpi: { key: "geo.score", value: null, comparison: compareMetric("geo.score", null, null) },
        history: [],
      },
    };
    const text = buildChatContext(report);
    expect(text).toContain("Google Analytics 4");
    expect(text).toContain("Not connected");
    expect(text).toContain("First sync still running");
    expect(text).toContain("No scan yet");
    expect(text).toContain("Published");
    expect(text).toMatch(/never add or compare numbers across them/);
  });
});
