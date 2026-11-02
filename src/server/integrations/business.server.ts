// Business apps through Composio (ADR-0042, Phase 4). Every tool goes through
// runIntegrationTool; the arguments come from the pure builders in
// src/lib/integrations/business.ts.
//
//   refreshLeadCounts    from the existing sdr-reconcile sweep: HubSpot's
//                        count of contacts added since the goal started, kept
//                        on integration_accounts.metadata.leads. The leads goal
//                        reads it as measured; nothing is estimated.
//   saveEmailDraft       a person's click: a content item becomes a Mailchimp
//                        draft campaign. Mellox never sends or schedules it.
//   exportCalendarToSheets  a person's click: the calendar to a new sheet.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import { isIntegrationsEnabled } from "@/lib/feature-flags";
import { GoalsSchema } from "@/lib/goals/contracts";
import {
  calendarValues,
  emailHtml,
  hubspotNewContactsArgs,
  leadCountDue,
  mailchimpCampaignArgs,
  mailchimpContentArgs,
  mailchimpDraftUrl,
  readLeadCount,
  readMailchimpLists,
  readSpreadsheet,
  readTotal,
  sheetValuesArgs,
  subjectFrom,
  type CalendarRow,
  type LeadCount,
  type MailchimpList,
} from "@/lib/integrations/business";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { entryFromContent, type CalendarSourceItem } from "@/lib/calendar/model";
import { signStoragePaths } from "@/server/assets/storage.server";
import { runIntegrationTool, type ToolCaller } from "./execute.server";

// Read on each call, so tests can swap the client in.
const db = {
  from: (table: string) => (supabaseAdmin as unknown as { from: (t: string) => any }).from(table),
};

type AppAccount = { id: string; metadata: Record<string, unknown> | null };

/** The workspace's active account for one app, oldest first; null when none. */
async function activeAccount(workspaceId: string, app: string): Promise<AppAccount | null> {
  const { data } = await db
    .from("integration_accounts")
    .select("id, metadata")
    .eq("workspace_id", workspaceId)
    .eq("app", app)
    .eq("status", "active")
    .order("connected_at", { ascending: true })
    .limit(1);
  return (data?.[0] as AppAccount | undefined) ?? null;
}

function requireOn(workspaceId: string) {
  if (!isIntegrationsEnabled(workspaceId)) throw new HttpError(404, "Not found");
}

// ── HubSpot: leads ────────────────────────────────────────────────────────

/** The stored lead count for the workspace's current goal, when there is one. */
export async function leadCountFor(
  workspaceId: string,
  goalStartedAt: string,
  reader: { from: (t: string) => any } = db,
): Promise<(LeadCount & { source: string }) | null> {
  const { data } = await reader
    .from("integration_accounts")
    .select("metadata")
    .eq("workspace_id", workspaceId)
    .eq("app", "hubspot")
    .eq("status", "active")
    .limit(1);
  const count = readLeadCount(data?.[0]?.metadata);
  return count && count.since === goalStartedAt ? { ...count, source: "HubSpot" } : null;
}

/** Refresh HubSpot lead counts that are due. A few accounts per sweep. */
export async function refreshLeadCounts(
  opts: { max?: number; now?: number } = {},
): Promise<{ refreshed: number; failed: number }> {
  const now = opts.now ?? Date.now();
  const { data: accounts } = await db
    .from("integration_accounts")
    .select("id, workspace_id, metadata, connected_by")
    .eq("app", "hubspot")
    .eq("status", "active")
    .limit(200);
  let refreshed = 0;
  let failed = 0;
  for (const account of accounts ?? []) {
    if (refreshed + failed >= (opts.max ?? 10)) break;
    if (!isIntegrationsEnabled(account.workspace_id)) continue;
    const { data: goalRow } = await db
      .from("workspace_goals")
      .select("goals")
      .eq("workspace_id", account.workspace_id)
      .maybeSingle();
    const goals = GoalsSchema.safeParse(goalRow?.goals);
    if (!goals.success || !goals.data.targets.some((t) => t.metric === "leads")) continue;
    const since = goals.data.startedAt;
    if (!leadCountDue(readLeadCount(account.metadata), since, now)) continue;
    try {
      const result = await runIntegrationTool({
        workspaceId: account.workspace_id,
        accountId: account.id,
        tool: "HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA",
        arguments: hubspotNewContactsArgs(new Date(since)),
        caller: { kind: "worker", actingUserId: account.connected_by },
        purpose: "goal",
      });
      const total = result.successful ? readTotal(result.data) : null;
      if (total === null) {
        failed++;
        continue;
      }
      await db
        .from("integration_accounts")
        .update({
          metadata: {
            ...(account.metadata ?? {}),
            leads: { value: total, since, measuredAt: new Date(now).toISOString() },
          },
        })
        .eq("id", account.id);
      refreshed++;
    } catch (error) {
      failed++;
      console.warn(
        "[integrations] HubSpot lead count failed",
        account.id,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { refreshed, failed };
}

// ── Mailchimp: a draft campaign ───────────────────────────────────────────

export async function listMailchimpAudiences(args: {
  workspaceId: string;
  caller: ToolCaller;
}): Promise<MailchimpList[]> {
  requireOn(args.workspaceId);
  const account = await activeAccount(args.workspaceId, "mailchimp");
  if (!account) throw new HttpError(409, "Connect Mailchimp first in Settings → Connections.");
  const result = await runIntegrationTool({
    workspaceId: args.workspaceId,
    accountId: account.id,
    tool: "MAILCHIMP_GET_LISTS_INFO",
    arguments: { count: 50 },
    caller: args.caller,
    purpose: "email",
  });
  if (!result.successful) throw new HttpError(502, result.error || "Mailchimp didn't answer.");
  return readMailchimpLists(result.data);
}

export async function saveEmailDraft(args: {
  workspaceId: string;
  userId: string;
  role: string;
  contentItemId: string;
  /** Mailchimp audience; the first one when not given. */
  listId?: string | null;
}): Promise<{ campaignId: string; url: string | null; audience: string }> {
  requireOn(args.workspaceId);
  const caller: ToolCaller = { kind: "person", userId: args.userId, role: args.role };
  const account = await activeAccount(args.workspaceId, "mailchimp");
  if (!account) throw new HttpError(409, "Connect Mailchimp first in Settings → Connections.");

  const { data: item } = await db
    .from("content_items")
    .select("id, workspace_id, title, body, meta")
    .eq("id", args.contentItemId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!item) throw new HttpError(404, "That post isn't in this workspace.");
  const body = String(item.body ?? "").trim();
  if (!body) throw new HttpError(400, "This post has no words to put in an email.");

  const lists = await listMailchimpAudiences({ workspaceId: args.workspaceId, caller });
  const list = args.listId ? lists.find((l) => l.id === args.listId) : lists[0];
  if (!list) throw new HttpError(409, "Make an audience in Mailchimp first.");

  const { data: ws } = await db
    .from("workspaces")
    .select("name")
    .eq("id", args.workspaceId)
    .maybeSingle();
  const path = item.meta?.asset_storage_path;
  const image =
    typeof path === "string" && isWorkspaceStoragePath(path, args.workspaceId)
      ? ((await signStoragePaths(supabaseAdmin as any, [path], 7 * 24 * 3600)).get(path) ?? null)
      : null;

  const approvalRef = `content:${item.id}`;
  const subject = subjectFrom(item.title, body);
  const created = await runIntegrationTool({
    workspaceId: args.workspaceId,
    accountId: account.id,
    tool: "MAILCHIMP_ADD_CAMPAIGN",
    arguments: mailchimpCampaignArgs({
      listId: list.id,
      subject,
      fromName: ws?.name || "Our team",
      title: `Mellox: ${subject}`,
    }),
    caller,
    purpose: "email",
    approvalRef,
  });
  const campaign = (created.data?.data ?? created.data) as Record<string, unknown>;
  const campaignId = typeof campaign?.id === "string" ? campaign.id : null;
  if (!created.successful || !campaignId) {
    throw new HttpError(502, created.error || "Mailchimp didn't make the draft.");
  }
  const content = await runIntegrationTool({
    workspaceId: args.workspaceId,
    accountId: account.id,
    tool: "MAILCHIMP_SET_CAMPAIGN_CONTENT",
    arguments: mailchimpContentArgs(campaignId, emailHtml(body, image), body),
    caller,
    purpose: "email",
    approvalRef,
  });
  if (!content.successful) {
    throw new HttpError(
      502,
      `The draft was made in Mailchimp but its words didn't save: ${content.error ?? "no reason given"}`,
    );
  }
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "integrations.mailchimp.draft",
    entity: item.id,
    payload: { campaignId, listId: list.id },
  });
  return { campaignId, url: mailchimpDraftUrl(campaign.web_id), audience: list.name };
}

// ── Google Sheets: the calendar ───────────────────────────────────────────

export async function exportCalendarToSheets(args: {
  workspaceId: string;
  userId: string;
  role: string;
  from: string;
  to: string;
  /** The posts on screen; when given, `from`/`to` only name the sheet. */
  ids?: string[];
}): Promise<{ url: string; rows: number }> {
  requireOn(args.workspaceId);
  const caller: ToolCaller = { kind: "person", userId: args.userId, role: args.role };
  const account = await activeAccount(args.workspaceId, "googlesheets");
  if (!account) throw new HttpError(409, "Connect Google Sheets first in Settings → Connections.");
  const from = new Date(args.from);
  const to = new Date(args.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) {
    throw new HttpError(400, "Pick a start and end date.");
  }
  if (to.getTime() - from.getTime() > 366 * 86_400_000) {
    throw new HttpError(400, "Export a year at most at a time.");
  }

  // The calendar's own placement (entryFromContent): scheduled time, else the
  // planned day, else the day it was written. With `ids`, exactly the posts on
  // the person's screen; otherwise every post placed between the two dates.
  let query = db
    .from("content_items")
    .select(
      "id, kind, channel, title, body, hashtags, media_url, status, scheduled_at, meta, created_at, updated_at",
    )
    .eq("workspace_id", args.workspaceId);
  query = args.ids?.length
    ? query.in("id", args.ids)
    : query.order("created_at", { ascending: false }).limit(1000);
  const { data: items, error } = await query;
  if (error) throw new Error(`Couldn't read the calendar: ${error.message}`);
  const fromDay = args.from.slice(0, 10);
  const toDay = args.to.slice(0, 10);
  const rows: CalendarRow[] = ((items ?? []) as CalendarSourceItem[])
    .map((item) => ({ item, entry: entryFromContent(item) }))
    .filter(({ entry }) => args.ids?.length || (entry.date >= fromDay && entry.date < toDay))
    .map(({ item, entry }) => {
      const meta = (item.meta ?? {}) as Record<string, unknown>;
      return {
        date: `${entry.date}T${entry.time}`,
        channel: entry.channel,
        status: entry.status,
        title: entry.title || null,
        text: entry.caption ?? String(item.body ?? ""),
        link: typeof meta.link_url === "string" ? meta.link_url : null,
      };
    });
  if (!rows.length) throw new HttpError(400, "There are no posts in those dates.");

  const approvalRef = `export:${args.userId}:${args.from}:${args.to}`;
  const created = await runIntegrationTool({
    workspaceId: args.workspaceId,
    accountId: account.id,
    tool: "GOOGLESHEETS_CREATE_GOOGLE_SHEET1",
    arguments: {
      title: `Mellox calendar ${args.from.slice(0, 10)} to ${args.to.slice(0, 10)}`,
    },
    caller,
    purpose: "export",
    approvalRef,
  });
  const sheet = created.successful ? readSpreadsheet(created.data) : null;
  if (!sheet) throw new HttpError(502, created.error || "Google didn't make the sheet.");
  const written = await runIntegrationTool({
    workspaceId: args.workspaceId,
    accountId: account.id,
    tool: "GOOGLESHEETS_UPDATE_VALUES_BATCH",
    arguments: sheetValuesArgs(sheet.id, calendarValues(rows)),
    caller,
    purpose: "export",
    approvalRef,
  });
  if (!written.successful) {
    throw new HttpError(
      502,
      `The sheet was made but the calendar didn't save in it: ${written.error ?? "no reason given"}`,
    );
  }
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "integrations.sheets.export",
    entity: sheet.id,
    payload: { rows: rows.length },
  });
  return { url: sheet.url, rows: rows.length };
}
