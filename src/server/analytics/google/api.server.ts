// api.server.ts — the only module that talks to Google's data APIs:
//   Google Analytics Admin API v1beta   (list/describe GA4 properties)
//   Google Analytics Data API v1beta    (runReport)
//   Google Search Console API v3         (sites, searchAnalytics.query)
// Hosts are fixed and trusted (not user-supplied), so these calls use the
// shared upstream transport (timeouts + backoff) rather than safe-fetch.
// Responses are validated with zod and reduced to the fields Mellox uses;
// raw bodies and tokens never leave this module.
import "server-only";
import { z } from "zod";
import { fetchWithRetry, UpstreamError } from "@/server/upstream";
import { classifyGoogleFailure, GoogleApiError } from "./errors";

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";
const GSC = "https://www.googleapis.com/webmasters/v3";

export type TokenProvider = (opts?: { forceRefresh?: boolean }) => Promise<string>;

export type Ga4PropertyOption = {
  propertyId: string; // "properties/123"
  displayName: string;
  accountName: string;
};

export type Ga4PropertyDetails = {
  propertyId: string;
  displayName: string;
  timeZone: string | null;
  currencyCode: string | null;
};

export type Ga4ReportRequest = {
  startDate: string;
  endDate: string;
  dimensions: string[];
  metrics: string[];
  limit?: number;
  orderBySessionsDesc?: boolean;
};

export type Ga4ReportRow = { dimensions: string[]; metrics: number[] };

export type Ga4ReportResult = {
  rows: Ga4ReportRow[];
  rowCount: number;
  tokensRemainingToday: number | null;
};

export type GscSiteOption = {
  siteUrl: string;
  permissionLevel: string;
};

export type GscQueryRequest = {
  startDate: string;
  endDate: string;
  dimensions: Array<"date" | "query" | "page" | "country" | "device">;
  rowLimit?: number;
  startRow?: number;
};

export type GscRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export interface GoogleApi {
  listGa4Properties(): Promise<Ga4PropertyOption[]>;
  getGa4Property(propertyId: string): Promise<Ga4PropertyDetails>;
  runGa4Report(propertyId: string, req: Ga4ReportRequest): Promise<Ga4ReportResult>;
  listGscSites(): Promise<GscSiteOption[]>;
  queryGsc(siteUrl: string, req: GscQueryRequest): Promise<GscRow[]>;
}

// ── Response schemas (only what we read) ────────────────────────────────────
const AccountSummaries = z.object({
  accountSummaries: z
    .array(
      z.object({
        displayName: z.string().optional(),
        propertySummaries: z
          .array(
            z.object({
              property: z.string(),
              displayName: z.string().optional(),
              propertyType: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
});

const Property = z.object({
  name: z.string(),
  displayName: z.string().optional(),
  timeZone: z.string().optional(),
  currencyCode: z.string().optional(),
});

const RunReport = z.object({
  rows: z
    .array(
      z.object({
        dimensionValues: z.array(z.object({ value: z.string().optional() })).optional(),
        metricValues: z.array(z.object({ value: z.string().optional() })).optional(),
      }),
    )
    .optional(),
  rowCount: z.number().optional(),
  propertyQuota: z
    .object({ tokensPerDay: z.object({ remaining: z.number().optional() }).optional() })
    .optional(),
});

const Sites = z.object({
  siteEntry: z.array(z.object({ siteUrl: z.string(), permissionLevel: z.string() })).optional(),
});

const SearchAnalytics = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()).optional(),
        clicks: z.number().optional(),
        impressions: z.number().optional(),
        ctr: z.number().optional(),
        position: z.number().optional(),
      }),
    )
    .optional(),
});

const PROPERTY_ID = /^properties\/\d{1,20}$/;

export function assertPropertyId(propertyId: string): string {
  if (!PROPERTY_ID.test(propertyId)) throw new GoogleApiError("not_found", "Invalid GA4 property.");
  return propertyId;
}

/** Search Console site: "sc-domain:example.com" or an http(s) URL prefix. */
export function assertSiteUrl(siteUrl: string): string {
  if (siteUrl.length > 300) throw new GoogleApiError("not_found", "Invalid Search Console site.");
  if (/^sc-domain:[a-z0-9.-]+$/i.test(siteUrl)) return siteUrl;
  try {
    const u = new URL(siteUrl);
    if ((u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password)
      return siteUrl;
  } catch {
    /* fall through */
  }
  throw new GoogleApiError("not_found", "Invalid Search Console site.");
}

export function siteHostOf(siteUrl: string): string | null {
  if (siteUrl.startsWith("sc-domain:")) return siteUrl.slice("sc-domain:".length).toLowerCase();
  try {
    return new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function createGoogleApi(getToken: TokenProvider): GoogleApi {
  async function call<T>(
    api: string,
    url: string,
    schema: z.ZodType<T>,
    init: { method?: "GET" | "POST"; body?: unknown } = {},
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await getToken({ forceRefresh: attempt > 0 });
      let res: Response;
      try {
        res = await fetchWithRetry(
          url,
          {
            method: init.method ?? "GET",
            headers: {
              authorization: `Bearer ${token}`,
              accept: "application/json",
              ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
            },
            body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
            cache: "no-store",
          },
          {
            timeoutMs: 30_000,
            retries: 2,
            baseDelayMs: 800,
            retryableStatuses: [429, 500, 502, 503, 504],
            onTransportError: (f) =>
              new UpstreamError(f.kind === "timeout" ? 504 : 502, `Google ${api} ${f.kind}`, {
                provider: "google",
              }),
          },
        );
      } catch (e) {
        if (e instanceof UpstreamError)
          throw new GoogleApiError("upstream", `Google ${api} didn't respond.`, { api });
        throw e;
      }
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (res.ok) {
        const parsed = schema.safeParse(body ?? {});
        if (!parsed.success)
          throw new GoogleApiError("upstream", `Google ${api} returned an unexpected response.`, {
            api,
          });
        return parsed.data;
      }
      const failure = classifyGoogleFailure(res.status, body, api, res.headers.get("retry-after"));
      // An access token can be revoked before its expiry: refresh once, then give up.
      if (failure.code === "token_expired" && attempt === 0) continue;
      throw failure;
    }
    throw new GoogleApiError("token_expired", "Google access has expired.", { api });
  }

  return {
    async listGa4Properties() {
      const out: Ga4PropertyOption[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 10; page++) {
        const url = new URL(`${ADMIN}/accountSummaries`);
        url.searchParams.set("pageSize", "200");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const data = await call("Google Analytics Admin", url.toString(), AccountSummaries);
        for (const account of data.accountSummaries ?? []) {
          for (const p of account.propertySummaries ?? []) {
            if (!PROPERTY_ID.test(p.property)) continue;
            out.push({
              propertyId: p.property,
              displayName: (p.displayName ?? p.property).slice(0, 200),
              accountName: (account.displayName ?? "Google Analytics").slice(0, 200),
            });
          }
        }
        pageToken = data.nextPageToken || undefined;
        if (!pageToken) break;
      }
      return out;
    },

    async getGa4Property(propertyId) {
      const data = await call(
        "Google Analytics Admin",
        `${ADMIN}/${assertPropertyId(propertyId)}`,
        Property,
      );
      return {
        propertyId: data.name,
        displayName: (data.displayName ?? data.name).slice(0, 200),
        timeZone: data.timeZone ?? null,
        currencyCode: data.currencyCode ?? null,
      };
    },

    async runGa4Report(propertyId, req) {
      const body = {
        dateRanges: [{ startDate: req.startDate, endDate: req.endDate }],
        dimensions: req.dimensions.map((name) => ({ name })),
        metrics: req.metrics.map((name) => ({ name })),
        limit: String(req.limit ?? 10_000),
        returnPropertyQuota: true,
        ...(req.orderBySessionsDesc
          ? { orderBys: [{ metric: { metricName: "sessions" }, desc: true }] }
          : {}),
      };
      const data = await call(
        "Google Analytics Data",
        `${DATA}/${assertPropertyId(propertyId)}:runReport`,
        RunReport,
        { method: "POST", body },
      );
      return {
        rows: (data.rows ?? []).map((r) => ({
          dimensions: (r.dimensionValues ?? []).map((v) => v.value ?? ""),
          metrics: (r.metricValues ?? []).map((v) => {
            const n = Number(v.value ?? "0");
            return Number.isFinite(n) ? n : 0;
          }),
        })),
        rowCount: data.rowCount ?? 0,
        tokensRemainingToday: data.propertyQuota?.tokensPerDay?.remaining ?? null,
      };
    },

    async listGscSites() {
      const data = await call("Search Console", `${GSC}/sites`, Sites);
      return (data.siteEntry ?? [])
        .filter((s) => s.permissionLevel !== "siteUnverifiedUser")
        .map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }));
    },

    async queryGsc(siteUrl, req) {
      const data = await call(
        "Search Console",
        `${GSC}/sites/${encodeURIComponent(assertSiteUrl(siteUrl))}/searchAnalytics/query`,
        SearchAnalytics,
        {
          method: "POST",
          body: {
            startDate: req.startDate,
            endDate: req.endDate,
            dimensions: req.dimensions,
            type: "web",
            // Final data only: fresh (partial) days would look like a drop.
            dataState: "final",
            rowLimit: req.rowLimit ?? 25_000,
            startRow: req.startRow ?? 0,
          },
        },
      );
      return (data.rows ?? []).map((r) => ({
        keys: r.keys ?? [],
        clicks: r.clicks ?? 0,
        impressions: r.impressions ?? 0,
        ctr: r.ctr ?? 0,
        position: r.position ?? 0,
      }));
    },
  };
}
