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
//   savePostToDrive      a person's click: a post's files into a Mellox folder.
//   saveGmailDraft       a person's click: a post as a Gmail draft (never sent).
//   sendAdToGoogleAds    an admin's click: a Studio ad as a paused campaign.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import { isIntegrationsEnabled } from "@/lib/feature-flags";
import { GoalsSchema } from "@/lib/goals/contracts";
import {
  DRIVE_FOLDER,
  calendarValues,
  driveFileName,
  driveFolderUrl,
  emailHtml,
  gmailDraftArgs,
  googleAdsAdArgs,
  googleAdsAdGroupArgs,
  googleAdsBudgetArgs,
  googleAdsCampaignArgs,
  googleAdsCampaignUrl,
  googleAdsKeywordArgs,
  googleAdsKeywordIdeasArgs,
  readKeywordIdeas,
  readCustomerIds,
  readDriveId,
  readGmailDraftId,
  readResourceName,
  rsaText,
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

// ── A post's own media ────────────────────────────────────────────────────

type PostRow = {
  id: string;
  kind: string | null;
  title: string | null;
  body: string | null;
  meta: Record<string, unknown> | null;
};

async function loadPost(workspaceId: string, id: string): Promise<PostRow> {
  const { data: item } = await db
    .from("content_items")
    .select("id, kind, title, body, meta")
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!item) throw new HttpError(404, "That post isn't in this workspace.");
  return item as PostRow;
}

/** The post's stored pictures and video, checked to be this workspace's files. */
function mediaPaths(item: PostRow, workspaceId: string): string[] {
  const meta = item.meta ?? {};
  const paths = Array.isArray(meta.asset_storage_paths)
    ? meta.asset_storage_paths
    : meta.asset_storage_path
      ? [meta.asset_storage_path]
      : [];
  return paths.filter(
    (p): p is string => typeof p === "string" && isWorkspaceStoragePath(p, workspaceId),
  );
}

// ── Google Drive: save a finished post ────────────────────────────────────

export async function savePostToDrive(args: {
  workspaceId: string;
  userId: string;
  role: string;
  contentItemId: string;
}): Promise<{ folderUrl: string; files: number }> {
  requireOn(args.workspaceId);
  const caller: ToolCaller = { kind: "person", userId: args.userId, role: args.role };
  const account = await activeAccount(args.workspaceId, "googledrive");
  if (!account) throw new HttpError(409, "Connect Google Drive first in Channels.");
  const item = await loadPost(args.workspaceId, args.contentItemId);
  const paths = mediaPaths(item, args.workspaceId);
  const words = String(item.body ?? "").trim();
  if (!paths.length && !words) throw new HttpError(400, "This post has nothing to save yet.");
  const approvalRef = `content:${item.id}`;
  const run = (tool: string, toolArgs: Record<string, unknown>) =>
    runIntegrationTool({
      workspaceId: args.workspaceId,
      accountId: account.id,
      tool,
      arguments: toolArgs,
      caller,
      purpose: "drive",
      approvalRef,
    });

  // One "Mellox" folder at the top of the Drive, found or made once.
  const found = await run("GOOGLEDRIVE_FIND_FOLDER", { name_exact: DRIVE_FOLDER, page_size: 1 });
  let folderId = found.successful ? readDriveId(found.data) : null;
  if (!folderId) {
    const made = await run("GOOGLEDRIVE_CREATE_FOLDER", { name: DRIVE_FOLDER });
    folderId = made.successful ? readDriveId(made.data) : null;
    if (!folderId) throw new HttpError(502, made.error || "Google Drive didn't make the folder.");
  }

  const signed = await signStoragePaths(supabaseAdmin as any, paths, 3600);
  let files = 0;
  for (const [n, path] of paths.entries()) {
    const url = signed.get(path);
    if (!url) continue;
    const saved = await run("GOOGLEDRIVE_UPLOAD_FROM_URL", {
      source_url: url,
      name: driveFileName(item.title, n, paths.length, path),
      parent_folder_id: folderId,
    });
    if (!saved.successful) {
      throw new HttpError(
        502,
        `${files} of ${paths.length} files were saved, then Drive refused one: ${saved.error ?? "no reason given"}`,
      );
    }
    files++;
  }
  if (words) {
    const text = await run("GOOGLEDRIVE_CREATE_FILE_FROM_TEXT", {
      file_name: driveFileName(item.title, 0, 1, "caption.txt"),
      text_content: words,
      mime_type: "text/plain",
      parent_id: folderId,
    });
    if (text.successful) files++;
  }
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "integrations.drive.save",
    entity: item.id,
    payload: { files },
  });
  return { folderUrl: driveFolderUrl(folderId), files };
}

// ── Gmail: a draft ────────────────────────────────────────────────────────

export async function saveGmailDraft(args: {
  workspaceId: string;
  userId: string;
  role: string;
  contentItemId: string;
}): Promise<{ draftId: string; url: string }> {
  requireOn(args.workspaceId);
  const caller: ToolCaller = { kind: "person", userId: args.userId, role: args.role };
  const account = await activeAccount(args.workspaceId, "gmail");
  if (!account) throw new HttpError(409, "Connect Gmail first in Channels.");
  const item = await loadPost(args.workspaceId, args.contentItemId);
  const body = String(item.body ?? "").trim();
  if (!body) throw new HttpError(400, "This post has no words to put in an email.");
  const [path] = mediaPaths(item, args.workspaceId);
  const image = path
    ? ((await signStoragePaths(supabaseAdmin as any, [path], 7 * 24 * 3600)).get(path) ?? null)
    : null;
  const result = await runIntegrationTool({
    workspaceId: args.workspaceId,
    accountId: account.id,
    tool: "GMAIL_CREATE_EMAIL_DRAFT",
    arguments: gmailDraftArgs(subjectFrom(item.title, body), emailHtml(body, image)),
    caller,
    purpose: "email",
    approvalRef: `content:${item.id}`,
  });
  const draftId = result.successful ? readGmailDraftId(result.data) : null;
  if (!draftId) throw new HttpError(502, result.error || "Gmail didn't save the draft.");
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "integrations.gmail.draft",
    entity: item.id,
    payload: { draftId },
  });
  return { draftId, url: "https://mail.google.com/mail/u/0/#drafts" };
}

// ── Google Ads: a paused Search campaign ──────────────────────────────────

/** A day's budget a person can set here: $1 to $1,000, in the account's currency. */
const DAILY_MIN = 1;
const DAILY_MAX = 1000;

export async function sendAdToGoogleAds(args: {
  workspaceId: string;
  userId: string;
  role: string;
  contentItemId: string;
  /** Daily budget in the ad account's own currency. */
  dailyBudget: number;
  /** Where people land; the brand's website when not given. */
  finalUrl?: string | null;
}): Promise<{ campaignUrl: string; campaign: string; keywords: string[] }> {
  requireOn(args.workspaceId);
  const caller: ToolCaller = { kind: "person", userId: args.userId, role: args.role };
  if (!(args.dailyBudget >= DAILY_MIN && args.dailyBudget <= DAILY_MAX)) {
    throw new HttpError(400, `Pick a daily budget between ${DAILY_MIN} and ${DAILY_MAX}.`);
  }
  const account = await activeAccount(args.workspaceId, "googleads");
  if (!account) throw new HttpError(409, "Connect Google Ads first in Channels.");
  const item = await loadPost(args.workspaceId, args.contentItemId);
  const ads = (Array.isArray(item.meta?.ad_variants) ? item.meta.ad_variants : [])
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({
      headline: String(a.headline ?? ""),
      primaryText: String(a.primaryText ?? ""),
      description: String(a.description ?? ""),
    }));
  if (!ads.length) throw new HttpError(400, "Only a Studio ad can go to Google Ads.");

  const { data: ws } = await db
    .from("workspaces")
    .select("name, domain")
    .eq("id", args.workspaceId)
    .maybeSingle();
  const finalUrl =
    args.finalUrl?.trim() ||
    (ws?.domain ? `https://${String(ws.domain).replace(/^https?:\/\//, "")}` : "");
  try {
    if (new URL(finalUrl).protocol !== "https:") throw new Error();
  } catch {
    throw new HttpError(400, "Add the page people should land on (an https link).");
  }
  const search =
    item.meta?.ad_search && typeof item.meta.ad_search === "object"
      ? (item.meta.ad_search as { headlines?: unknown; descriptions?: unknown })
      : null;
  const text = rsaText(ads, ws?.name ?? "", search);
  if (!text) throw new HttpError(400, "This ad needs a little more text for Google (3 headlines).");

  const approvalRef = `ad:${item.id}`;
  const run = async (tool: string, toolArgs: Record<string, unknown>, what: string) => {
    const result = await runIntegrationTool({
      workspaceId: args.workspaceId,
      accountId: account.id,
      tool,
      arguments: toolArgs,
      caller,
      purpose: "ads",
      approvalRef,
    });
    if (!result.successful)
      throw new HttpError(
        502,
        `Google Ads didn't make the ${what}: ${result.error ?? "no reason given"}`,
      );
    return result.data;
  };

  const customers = readCustomerIds(
    await run("GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS", {}, "account list"),
  );
  const customerId = customers[0];
  if (!customerId) throw new HttpError(409, "No Google Ads account was found for this sign-in.");

  const name = `Mellox · ${subjectFrom(item.title, ads[0].headline).slice(0, 60)} · ${new Date().toISOString().slice(0, 10)}`;
  const budget = readResourceName(
    await run(
      "GOOGLEADS_MUTATE_CAMPAIGN_BUDGETS",
      googleAdsBudgetArgs(customerId, `${name} budget`, Math.round(args.dailyBudget * 1_000_000)),
      "budget",
    ),
    "campaignBudgets",
  );
  if (!budget) throw new HttpError(502, "Google Ads didn't return the budget it made.");
  const campaign = readResourceName(
    await run(
      "GOOGLEADS_MUTATE_CAMPAIGNS_V2",
      googleAdsCampaignArgs(customerId, name, budget),
      "campaign",
    ),
    "campaigns",
  );
  if (!campaign) throw new HttpError(502, "Google Ads didn't return the campaign it made.");
  const adGroup = readResourceName(
    await run(
      "GOOGLEADS_MUTATE_AD_GROUPS",
      googleAdsAdGroupArgs(customerId, "Ad group 1", campaign),
      "ad group",
    ),
    "adGroups",
  );
  if (!adGroup) throw new HttpError(502, "Google Ads didn't return the ad group it made.");
  await run(
    "GOOGLEADS_MUTATE_AD_GROUP_ADS",
    googleAdsAdArgs(customerId, adGroup, text, finalUrl),
    "ad",
  );

  // Keywords Google itself suggests for the landing page, so the campaign is
  // ready to switch on. A failure leaves an ad group without keywords, which
  // the person can fill in Google Ads; the campaign is still made.
  let keywords: string[] = [];
  try {
    keywords = readKeywordIdeas(
      await run(
        "GOOGLEADS_GENERATE_KEYWORD_IDEAS",
        googleAdsKeywordIdeasArgs(customerId, finalUrl),
        "keyword ideas",
      ),
    );
    if (keywords.length)
      await run(
        "GOOGLEADS_MUTATE_AD_GROUP_CRITERIA",
        googleAdsKeywordArgs(customerId, adGroup, keywords),
        "keywords",
      );
  } catch (error) {
    keywords = [];
    console.warn(
      "[integrations] Google Ads keywords skipped",
      error instanceof Error ? error.message : error,
    );
  }

  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "integrations.googleads.paused_campaign",
    entity: item.id,
    payload: { customerId, campaign, dailyBudget: args.dailyBudget, keywords: keywords.length },
  });
  // Analytics reads this account's campaigns from now on.
  await db
    .from("integration_accounts")
    .update({ metadata: { ...(account.metadata ?? {}), customerId } })
    .eq("id", account.id);
  return { campaign, campaignUrl: googleAdsCampaignUrl(customerId, campaign), keywords };
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
