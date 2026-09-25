import { describe, expect, it, vi } from "vitest";
import type {
  GoogleApi,
  Ga4ReportRequest,
  GscQueryRequest,
} from "@/server/analytics/google/api.server";
import {
  GA4_TOKEN_FLOOR,
  prefixOf,
  pullGa4PageDaily,
  pullGscPageDaily,
  pullGscPages,
} from "./google.server";
import { commonPrefix } from "./metrics.server";

vi.mock("@/server/analytics/google/tokens.server", () => ({ googleApiFor: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

function fakeApi(over: Partial<GoogleApi>): GoogleApi {
  return {
    listGa4Properties: vi.fn(),
    getGa4Property: vi.fn(),
    runGa4Report: vi.fn(),
    listGscSites: vi.fn(),
    queryGsc: vi.fn(),
    ...over,
  } as GoogleApi;
}

describe("Search Console pulls", () => {
  it("keeps only this site's pages, normalises paths and sums duplicates", async () => {
    const api = fakeApi({
      queryGsc: vi.fn(async () => [
        { keys: ["https://shop.com/products/a/"], clicks: 3, impressions: 30, ctr: 0, position: 2 },
        {
          keys: ["https://www.shop.com/products/a"],
          clicks: 2,
          impressions: 20,
          ctr: 0,
          position: 4,
        },
        { keys: ["https://other.com/products/a"], clicks: 9, impressions: 90, ctr: 0, position: 1 },
      ]),
    });
    const pages = await pullGscPages(
      api,
      "sc-domain:shop.com",
      "shop.com",
      "2026-01-01",
      "2026-01-31",
    );
    expect(pages).toEqual([{ path: "/products/a", clicks: 5, impressions: 50 }]);
  });

  it("pages through results and filters to the group's prefix and paths", async () => {
    const calls: GscQueryRequest[] = [];
    const full = Array.from({ length: 25_000 }, (_, i) => ({
      keys: ["2026-01-01", `https://shop.com/products/p${i % 3}`],
      clicks: 1,
      impressions: 10,
      ctr: 0,
      position: 3,
    }));
    const api = fakeApi({
      queryGsc: vi.fn(async (_site: string, req: GscQueryRequest) => {
        calls.push(req);
        return req.startRow === 0 ? full : full.slice(0, 5);
      }),
    });
    const out = await pullGscPageDaily(
      api,
      "sc-domain:shop.com",
      "shop.com",
      "2026-01-01",
      "2026-01-02",
      {
        prefix: "/products/",
        paths: new Set(["/products/p0", "/products/p1"]),
      },
    );
    expect(calls).toHaveLength(2);
    expect(calls[1].startRow).toBe(25_000);
    expect(calls[0].filters).toEqual([
      { dimension: "page", operator: "contains", expression: "/products/" },
    ]);
    expect([...out.keys()].sort()).toEqual(["/products/p0", "/products/p1"]);
    const day = out.get("/products/p0")!.get("2026-01-01")!;
    expect(day.position_weighted).toBe(day.impressions * 3);
  });
});

describe("GA4 pulls", () => {
  const row = (date: string, page: string, source: string, channel: string, sessions: number) => ({
    dimensions: [date, page, source, channel],
    metrics: [sessions, 1, 10],
  });

  it("counts organic search for sessions and revenue, and AI assistants separately", async () => {
    const reqs: Ga4ReportRequest[] = [];
    const api = fakeApi({
      runGa4Report: vi.fn(async (_p: string, req: Ga4ReportRequest) => {
        reqs.push(req);
        return {
          rows: [
            row("20260101", "/products/a/", "google", "Organic Search", 5),
            row("20260101", "/products/a", "chatgpt.com", "Referral", 2),
            row("20260101", "/products/a", "facebook.com", "Organic Social", 7),
            row("20260101", "/not-assigned", "google", "Organic Search", 50),
          ],
          rowCount: 4,
          tokensRemainingToday: 50_000,
        };
      }),
    });
    const out = await pullGa4PageDaily(api, "123", "2026-01-01", "2026-01-01", ["/products/a"]);
    expect(out.deferred).toBe(false);
    expect(out.rows.get("/products/a")!.get("2026-01-01")).toEqual({
      sessions: 5,
      key_events: 1,
      revenue: 10,
      ai_referral_sessions: 2,
    });
    expect(out.rows.has("/not-assigned")).toBe(false);
    expect(reqs[0].inListFilter?.values).toEqual(["/products/a", "/products/a/"]);
  });

  it("stops below the daily quota floor instead of exhausting the property", async () => {
    const run = vi.fn(async () => ({
      rows: [],
      rowCount: 0,
      tokensRemainingToday: GA4_TOKEN_FLOOR - 1,
    }));
    const paths = Array.from({ length: 150 }, (_, i) => `/p/${i}`);
    const out = await pullGa4PageDaily(
      fakeApi({ runGa4Report: run }),
      "1",
      "2026-01-01",
      "2026-01-02",
      paths,
    );
    expect(out.deferred).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("prefixes", () => {
  it("uses the literal part of a pattern or the shared part of paths", () => {
    expect(prefixOf("/products/*")).toBe("/products/");
    expect(prefixOf("/*")).toBeNull();
    expect(commonPrefix(["/blog/a", "/blog/b"])).toBe("/blog/");
    expect(commonPrefix(["/a", "/b"])).toBeNull();
  });
});
