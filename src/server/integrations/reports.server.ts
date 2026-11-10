// Numbers from connected business apps for Analytics (ADR-0042):
//   Google Ads  spend, clicks, impressions and conversions per campaign, last 30 days;
//   HubSpot     new contacts in the last 30 days and the 30 before.
// Kept on integration_accounts.metadata.report (no new table), read by the
// existing sdr-reconcile sweep (each account every 6 h), right after a
// connection, and by Analytics' Refresh. Every read goes through
// runIntegrationTool; nothing here writes to the app.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { isIntegrationsEnabled } from "@/lib/feature-flags";
import { readCustomerIds, readTotal } from "@/lib/integrations/business";
import {
  APP_REPORT_DAYS,
  appReportDue,
  googleAdsReportQuery,
  hubspotContactsBetween,
  readAppReport,
  readGoogleAdsReport,
  reportWindow,
  type AppReport,
  type GoogleAdsReport,
  type HubspotReport,
} from "@/lib/integrations/reports";
import { runIntegrationTool } from "./execute.server";

const db = {
  from: (table: string) => (supabaseAdmin as unknown as { from: (t: string) => any }).from(table),
};

const REPORT_APPS = ["googleads", "hubspot"] as const;

type Account = {
  id: string;
  workspace_id: string;
  app: string;
  metadata: Record<string, unknown> | null;
  connected_by: string | null;
  status: string;
};

async function measure(account: Account, now: number): Promise<AppReport | null> {
  const run = async (tool: string, args: Record<string, unknown>) => {
    const result = await runIntegrationTool({
      workspaceId: account.workspace_id,
      accountId: account.id,
      tool,
      arguments: args,
      caller: { kind: "worker", actingUserId: account.connected_by },
      purpose: "report",
      timeoutMs: 45_000,
    });
    if (!result.successful) throw new Error(`${tool}: ${result.error ?? "no result"}`);
    return result.data;
  };
  const window = reportWindow(now);
  const measuredAt = new Date(now).toISOString();
  if (account.app === "googleads") {
    const known = (account.metadata?.customerId as string | undefined) ?? null;
    const customerId =
      known && /^\d{6,12}$/.test(known)
        ? known
        : readCustomerIds(await run("GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS", {}))[0];
    if (!customerId) return null;
    const data = await run("GOOGLEADS_SEARCH_GAQL", {
      customer_id: customerId,
      query: googleAdsReportQuery(window.from, window.to),
    });
    return readGoogleAdsReport(data, { customerId, from: window.from, to: window.to, measuredAt });
  }
  if (account.app === "hubspot") {
    const to = new Date(`${window.to}T23:59:59.999Z`);
    const from = new Date(to.getTime() - APP_REPORT_DAYS * 86_400_000);
    const prevFrom = new Date(from.getTime() - APP_REPORT_DAYS * 86_400_000);
    const last = readTotal(
      await run("HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA", hubspotContactsBetween(from, to)),
    );
    if (last === null) return null;
    let previous: number | null = null;
    try {
      previous = readTotal(
        await run("HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA", hubspotContactsBetween(prevFrom, from)),
      );
    } catch {
      /* The change just isn't shown. */
    }
    return { kind: "hubspot", measuredAt, last, previous } satisfies HubspotReport;
  }
  return null;
}

async function save(account: Account, report: AppReport) {
  const metadata = { ...(account.metadata ?? {}), report };
  if (report.kind === "googleads")
    (metadata as Record<string, unknown>).customerId = report.customerId;
  await db.from("integration_accounts").update({ metadata }).eq("id", account.id);
}

/** Read one account's report now. Returns it, or null when the app gave nothing readable. */
export async function refreshAppReport(
  accountId: string,
  now = Date.now(),
): Promise<AppReport | null> {
  const { data } = await db
    .from("integration_accounts")
    .select("id, workspace_id, app, metadata, connected_by, status")
    .eq("id", accountId)
    .maybeSingle();
  const account = data as Account | null;
  if (!account || account.status !== "active" || !REPORT_APPS.includes(account.app as never))
    return null;
  if (!isIntegrationsEnabled(account.workspace_id)) return null;
  const report = await measure(account, now);
  if (report) await save(account, report);
  return report;
}

/** The sweep: reports that are due, a few per run. */
export async function refreshAppReports(
  opts: { max?: number; now?: number } = {},
): Promise<{ refreshed: number; failed: number }> {
  const now = opts.now ?? Date.now();
  const { data } = await db
    .from("integration_accounts")
    .select("id, workspace_id, app, metadata, connected_by, status")
    .in("app", [...REPORT_APPS])
    .eq("status", "active")
    .limit(300);
  let refreshed = 0;
  let failed = 0;
  for (const account of (data ?? []) as Account[]) {
    if (refreshed + failed >= (opts.max ?? 6)) break;
    if (!isIntegrationsEnabled(account.workspace_id)) continue;
    if (!appReportDue(readAppReport(account.metadata), now)) continue;
    try {
      const report = await measure(account, now);
      if (report) {
        await save(account, report);
        refreshed++;
      } else failed++;
    } catch (error) {
      failed++;
      // Mark it measured-attempted so a broken account doesn't hog every sweep.
      const last = readAppReport(account.metadata);
      if (last) await save(account, { ...last, measuredAt: new Date(now).toISOString() });
      console.warn(
        "[integrations] app report failed",
        account.id,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { refreshed, failed };
}

export type AppReportsView = {
  enabled: boolean;
  googleads: { connected: boolean; accountId: string | null; report: GoogleAdsReport | null };
  hubspot: { connected: boolean; accountId: string | null; report: HubspotReport | null };
};

/** What Analytics shows for the verified workspace. Stored rows only; starts nothing. */
export async function getAppReports(workspaceId: string): Promise<AppReportsView> {
  const empty = { connected: false, accountId: null, report: null };
  if (!isIntegrationsEnabled(workspaceId))
    return { enabled: false, googleads: empty, hubspot: empty };
  const { data } = await db
    .from("integration_accounts")
    .select("id, app, metadata, status, connected_at")
    .eq("workspace_id", workspaceId)
    .in("app", [...REPORT_APPS])
    .eq("status", "active")
    .order("connected_at", { ascending: true });
  const view: AppReportsView = {
    enabled: true,
    googleads: { ...empty },
    hubspot: { ...empty },
  };
  for (const row of (data ?? []) as Array<{ id: string; app: string; metadata: unknown }>) {
    const slot = row.app === "googleads" ? view.googleads : view.hubspot;
    if (slot.connected) continue;
    const report = readAppReport(row.metadata);
    slot.connected = true;
    slot.accountId = row.id;
    if (row.app === "googleads" && report?.kind === "googleads") view.googleads.report = report;
    if (row.app === "hubspot" && report?.kind === "hubspot") view.hubspot.report = report;
  }
  return view;
}

/** A person's Refresh: read every report of this workspace again. */
export async function refreshWorkspaceReports(workspaceId: string): Promise<AppReportsView> {
  if (!isIntegrationsEnabled(workspaceId)) throw new HttpError(404, "Not found");
  const view = await getAppReports(workspaceId);
  for (const slot of [view.googleads, view.hubspot]) {
    if (!slot.accountId) continue;
    try {
      await refreshAppReport(slot.accountId);
    } catch (error) {
      console.warn(
        "[integrations] refresh failed",
        slot.accountId,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return getAppReports(workspaceId);
}
