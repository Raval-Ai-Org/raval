// What a connected business app tells Analytics (ADR-0042). Pure and
// browser-safe: the Google Ads query, readers for its result and HubSpot's
// counts, and the stored shape on integration_accounts.metadata.report.
//
// Only measured numbers. A field the app didn't return is left out, never 0;
// a failed read keeps the last report and says when it was measured.

/** A report is read again after this long (sweep or a person's Refresh). */
export const APP_REPORT_EVERY_MS = 6 * 3600_000;
/** Days in each window: the last 30 and the 30 before. */
export const APP_REPORT_DAYS = 30;
/** Campaigns kept on the stored report, by spend. */
export const ADS_TOP_CAMPAIGNS = 8;

export type AdsCampaign = {
  id: string;
  name: string;
  status: string;
  impressions?: number;
  clicks?: number;
  /** In the account's currency, not micros. */
  cost?: number;
  conversions?: number;
};

export type AdsTotals = {
  impressions?: number;
  clicks?: number;
  cost?: number;
  conversions?: number;
};

export type GoogleAdsReport = {
  kind: "googleads";
  measuredAt: string;
  from: string;
  to: string;
  customerId: string;
  currency: string | null;
  totals: AdsTotals;
  campaigns: AdsCampaign[];
  /** Campaigns with any status in the window. */
  campaignCount: number;
};

export type HubspotReport = {
  kind: "hubspot";
  measuredAt: string;
  /** New contacts in the last APP_REPORT_DAYS days. */
  last: number;
  /** New contacts in the APP_REPORT_DAYS before that. */
  previous: number | null;
};

export type AppReport = GoogleAdsReport | HubspotReport;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null;

function num(v: unknown): number | undefined {
  const n = typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The two windows ending yesterday (today's numbers are still moving). */
export function reportWindow(now: number): { from: string; to: string; prevFrom: string } {
  const to = new Date(now - 86_400_000);
  const from = new Date(to.getTime() - (APP_REPORT_DAYS - 1) * 86_400_000);
  const prevFrom = new Date(from.getTime() - APP_REPORT_DAYS * 86_400_000);
  return { from: day(from), to: day(to), prevFrom: day(prevFrom) };
}

/** GAQL for per-campaign numbers in a window. Dates are built here, never from input. */
export function googleAdsReportQuery(from: string, to: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    throw new Error("bad report dates");
  return [
    "SELECT campaign.id, campaign.name, campaign.status, customer.currency_code,",
    "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions",
    "FROM campaign",
    `WHERE segments.date BETWEEN '${from}' AND '${to}'`,
    "AND campaign.status != 'REMOVED'",
    "ORDER BY metrics.cost_micros DESC",
    "LIMIT 200",
  ].join(" ");
}

/** Composio returns Google's answer as a JSON string under `data`, sometimes already parsed. */
function rows(data: unknown): Obj[] {
  let value: unknown = data;
  for (let i = 0; i < 3; i++) {
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        return [];
      }
      continue;
    }
    const o = obj(value);
    if (!o) break;
    if (Array.isArray(o.results)) return o.results.map(obj).filter((r): r is Obj => !!r);
    if (Array.isArray(o)) break;
    // A stream answers with batches, each with its own results.
    if (Array.isArray(o.data))
      return (o.data as unknown[]).flatMap((b) => {
        const batch = obj(b);
        return Array.isArray(batch?.results)
          ? (batch.results as unknown[]).map(obj).filter((r): r is Obj => !!r)
          : [];
      });
    value = o.data ?? o.response ?? null;
  }
  return Array.isArray(value) ? (value as unknown[]).map(obj).filter((r): r is Obj => !!r) : [];
}

/** Google's field, camelCase (REST) or snake_case (some proxies). */
function field(o: Obj | null, camel: string, snake: string): unknown {
  return o ? (o[camel] ?? o[snake]) : undefined;
}

function add(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined ? b : b === undefined ? a : a + b;
}

/** The report in a GAQL result; null when nothing readable came back. */
export function readGoogleAdsReport(
  data: unknown,
  args: { customerId: string; from: string; to: string; measuredAt: string },
): GoogleAdsReport | null {
  const byId = new Map<string, AdsCampaign>();
  let currency: string | null = null;
  let sawRow = false;
  for (const row of rows(data)) {
    const campaign = obj(row.campaign);
    const metrics = obj(row.metrics);
    const id = String(campaign?.id ?? "");
    if (!/^\d+$/.test(id)) continue;
    sawRow = true;
    const code = field(obj(row.customer), "currencyCode", "currency_code");
    if (typeof code === "string" && /^[A-Z]{3}$/.test(code)) currency = code;
    const micros = num(field(metrics, "costMicros", "cost_micros"));
    const next: AdsCampaign = {
      id,
      name: String(campaign?.name ?? `Campaign ${id}`).slice(0, 120),
      status: String(campaign?.status ?? "UNKNOWN"),
      impressions: num(metrics?.impressions),
      clicks: num(metrics?.clicks),
      cost: micros === undefined ? undefined : micros / 1_000_000,
      conversions: num(metrics?.conversions),
    };
    // Rows are per day when segmented; fold them into one per campaign.
    const prev = byId.get(id);
    byId.set(
      id,
      prev
        ? {
            ...prev,
            impressions: add(prev.impressions, next.impressions),
            clicks: add(prev.clicks, next.clicks),
            cost: add(prev.cost, next.cost),
            conversions: add(prev.conversions, next.conversions),
          }
        : next,
    );
  }
  if (!sawRow && rows(data).length === 0 && !isEmptyAnswer(data)) return null;
  const all = [...byId.values()];
  const totals: AdsTotals = {};
  for (const c of all) {
    totals.impressions = add(totals.impressions, c.impressions);
    totals.clicks = add(totals.clicks, c.clicks);
    totals.cost = add(totals.cost, c.cost);
    totals.conversions = add(totals.conversions, c.conversions);
  }
  const round = (v: number | undefined, places = 2) =>
    v === undefined ? undefined : Math.round(v * 10 ** places) / 10 ** places;
  return {
    kind: "googleads",
    measuredAt: args.measuredAt,
    from: args.from,
    to: args.to,
    customerId: args.customerId,
    currency,
    totals: {
      impressions: totals.impressions,
      clicks: totals.clicks,
      cost: round(totals.cost),
      conversions: round(totals.conversions, 1),
    },
    campaigns: all
      .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || (b.clicks ?? 0) - (a.clicks ?? 0))
      .slice(0, ADS_TOP_CAMPAIGNS)
      .map((c) => ({ ...c, cost: round(c.cost), conversions: round(c.conversions, 1) })),
    campaignCount: all.length,
  };
}

/** An answer that says "no rows" (a new account) rather than failing to parse. */
function isEmptyAnswer(data: unknown): boolean {
  let value: unknown = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return false;
    }
  }
  const o = obj(value);
  if (!o) return false;
  if (Array.isArray(o.results) || "fieldMask" in o || "field_mask" in o) return true;
  const inner = o.data;
  if (typeof inner === "string" || obj(inner)) return isEmptyAnswer(inner);
  return Array.isArray(inner);
}

/** Click-through rate as a percentage, when both numbers were reported. */
export function ctrOf(t: { impressions?: number; clicks?: number }): number | undefined {
  return t.impressions && t.clicks !== undefined
    ? Math.round((t.clicks / t.impressions) * 1000) / 10
    : undefined;
}

/** Cost per conversion, when both were reported and there was one. */
export function costPerConversion(t: { cost?: number; conversions?: number }): number | undefined {
  return t.cost !== undefined && t.conversions
    ? Math.round((t.cost / t.conversions) * 100) / 100
    : undefined;
}

/** HubSpot contacts created inside [from, to) as search arguments. */
export function hubspotContactsBetween(from: Date, to: Date): Record<string, unknown> {
  return {
    filterGroups: [
      {
        filters: [
          { propertyName: "createdate", operator: "GTE", value: String(from.getTime()) },
          { propertyName: "createdate", operator: "LT", value: String(to.getTime()) },
        ],
      },
    ],
    properties: ["createdate"],
    limit: 1,
  };
}

/** The stored report, if it is one Mellox wrote. */
export function readAppReport(metadata: unknown): AppReport | null {
  const r = obj(obj(metadata)?.report);
  if (!r || typeof r.measuredAt !== "string") return null;
  if (r.kind === "googleads" && obj(r.totals) && Array.isArray(r.campaigns))
    return r as unknown as GoogleAdsReport;
  if (r.kind === "hubspot" && typeof r.last === "number") return r as unknown as HubspotReport;
  return null;
}

export function appReportDue(report: AppReport | null, now: number): boolean {
  return !report || now - Date.parse(report.measuredAt) >= APP_REPORT_EVERY_MS;
}

/** Change from the previous window as a whole percentage; null when it can't be said. */
export function changePercent(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
