// Social publishing through Composio (ADR-0042, Phase 2).
//
//   syncDestinations   after a social app connects: look up where it can post
//                      (the Instagram business account, each Facebook Page,
//                      each Pinterest board, the LinkedIn profile, each
//                      YouTube channel) and mirror each one into
//                      social_accounts (provider 'composio'), so the publish
//                      picker, Analytics and the calendar list them as usual.
//   composioAccounts   those rows as ConnectedAccounts for distribute().
//   deliver            send one approved item to its Composio targets now, or
//                      park the rows as `pending` for its scheduled time.
//   runDueComposioPublications
//                      the scheduled half, from the existing run-schedules
//                      hook: Composio has no queue of its own.
//
// Rules kept from the Post for Me path:
//   - every tool runs through runIntegrationTool (workspace, allow-list,
//     approval reference, rate limit, audit);
//   - a row is claimed (pending → publishing, compare-and-set) before sending,
//     and a send is never retried by itself: a timeout on the publishing call
//     is recorded as failed with error_code `unknown_outcome`, and only a
//     person's "Retry" sends it again;
//   - an item is sent only while it still reads `scheduled` (approved and
//     scheduled by a person); an edit moves it back to draft and its parked
//     rows are cancelled.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { integrationApp } from "@/lib/integrations/catalog";
import type { ConnectedAccount } from "@/lib/sdr.handlers";
import { COMPOSIO_PUBLISHING } from "@/lib/social/routing";
import {
  isFileArg,
  planPublish,
  postUrl,
  resolveArgs,
  resultId,
  type ComposioPost,
  type ComposioSocialPlatform,
} from "@/lib/social/composio/requests";
import {
  DESTINATION_LOOKUP,
  destinationAccountId,
  parseDestinationAccountId,
  readDestinations,
} from "@/lib/social/composio/destinations";
import { ComposioGatewayError } from "@/server/integrations/composio/gateway.server";
import { runIntegrationTool, stageIntegrationFile } from "@/server/integrations/execute.server";
import { safeFetch } from "@/server/safe-fetch";

// Read on each call, so tests can swap the client in.
const db = {
  from: (table: string) => (supabaseAdmin as unknown as { from: (t: string) => any }).from(table),
};

const PROVIDER = "composio";
/** Long enough for Instagram to process a Reel before publishing it. */
const PUBLISH_TIMEOUT_MS = 330_000;
/** A `publishing` row older than this was cut off midway. */
const STUCK_AFTER_MS = 15 * 60_000;

function isPublishingPlatform(value: string): value is ComposioSocialPlatform {
  return (COMPOSIO_PUBLISHING as readonly string[]).includes(value);
}

// ── Destinations ──────────────────────────────────────────────────────────

/**
 * Look up where a just-connected social app can post and mirror it into
 * social_accounts. Returns how many destinations were found; zero leaves the
 * connection active with a plain reason on it.
 */
export async function syncDestinations(args: {
  workspaceId: string;
  integrationAccountId: string;
  app: string;
  connectedBy: string | null;
}): Promise<number> {
  if (!isPublishingPlatform(args.app)) return 0;
  const lookup = DESTINATION_LOOKUP[args.app as keyof typeof DESTINATION_LOOKUP];
  if (!lookup) return 0;
  const result = await runIntegrationTool({
    workspaceId: args.workspaceId,
    accountId: args.integrationAccountId,
    tool: lookup.tool,
    arguments: lookup.args,
    caller: { kind: "worker", actingUserId: args.connectedBy },
    purpose: "connect",
  });
  const destinations = result.successful ? readDestinations(args.app, result.data) : [];
  const now = new Date().toISOString();
  if (!destinations.length) {
    const name = integrationApp(args.app)?.name ?? args.app;
    await db
      .from("integration_accounts")
      .update({
        last_error:
          args.app === "facebook"
            ? "No Facebook Page found. Connect again and pick a Page you manage."
            : args.app === "pinterest"
              ? "No Pinterest board found. Make a board, then connect again."
              : args.app === "youtube"
                ? "No YouTube channel found. Create a channel, then connect again."
                : args.app === "linkedin"
                  ? "Mellox couldn't read this LinkedIn profile. Connect again."
                  : `Mellox couldn't read this ${name} account. Use a Business or Creator account.`,
      })
      .eq("id", args.integrationAccountId);
    return 0;
  }
  const rows = destinations.map((d) => ({
    workspace_id: args.workspaceId,
    provider: PROVIDER,
    provider_account_id: destinationAccountId(args.integrationAccountId, d.id),
    integration_account_id: args.integrationAccountId,
    platform: args.app,
    username: d.username,
    display_name: d.displayName,
    avatar_url: d.avatarUrl,
    status: "active",
    reconnect_reason: null,
    disconnected_at: null,
    connected_by: args.connectedBy,
    connected_at: now,
    last_synced_at: now,
    updated_at: now,
  }));
  const { error } = await db
    .from("social_accounts")
    .upsert(rows, { onConflict: "provider,provider_account_id" });
  if (error) throw new Error(`Couldn't save the accounts: ${error.message}`);
  await db
    .from("integration_accounts")
    .update({ last_error: null, external_id: destinations[0].id })
    .eq("id", args.integrationAccountId);
  return destinations.length;
}

/** The workspace's Composio destinations, shaped like any connected account. */
export async function composioAccounts(workspaceId: string): Promise<ConnectedAccount[]> {
  const { data, error } = await db
    .from("social_accounts")
    .select(
      "provider_account_id, platform, username, display_name, avatar_url, status, reconnect_reason, integration_accounts!inner(status, last_error)",
    )
    .eq("workspace_id", workspaceId)
    .eq("provider", PROVIDER)
    .neq("status", "disconnected");
  if (error) {
    console.error("[composio-social] accounts read failed", error.message);
    return [];
  }
  return (data ?? [])
    .filter((row: any) => row.integration_accounts?.status !== "disconnected")
    .map((row: any) => {
      const appActive = row.integration_accounts?.status === "active";
      return {
        accountId: row.provider_account_id,
        platform: row.platform,
        platformUsername: row.username || row.display_name || "",
        displayName: row.display_name ?? null,
        avatarUrl: row.avatar_url ?? null,
        status: appActive && row.status === "active" ? "active" : "expired",
        reconnectReason: appActive
          ? (row.reconnect_reason ?? null)
          : (row.integration_accounts?.last_error ?? "Reconnect it in Settings → Connections."),
        tokenExpiresAt: null,
        provider: PROVIDER,
      } satisfies ConnectedAccount;
    });
}

/**
 * Stop posting to one destination. The connection itself is retired (and
 * removed at Composio) by the caller once no destination is left.
 */
export async function disconnectDestination(
  workspaceId: string,
  accountId: string,
): Promise<{ found: boolean; integrationAccountId: string | null; remaining: number }> {
  const parsed = parseDestinationAccountId(accountId);
  if (!parsed) return { found: false, integrationAccountId: null, remaining: 0 };
  const now = new Date().toISOString();
  const { data } = await db
    .from("social_accounts")
    .update({ status: "disconnected", disconnected_at: now, updated_at: now })
    .eq("workspace_id", workspaceId)
    .eq("provider", PROVIDER)
    .eq("provider_account_id", accountId)
    .select("id");
  if (!Array.isArray(data) || data.length === 0) {
    return { found: false, integrationAccountId: null, remaining: 0 };
  }
  const { count } = await db
    .from("social_accounts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("integration_account_id", parsed.integrationAccountId)
    .neq("status", "disconnected");
  return { found: true, integrationAccountId: parsed.integrationAccountId, remaining: count ?? 0 };
}

// ── Sending ───────────────────────────────────────────────────────────────

export type ComposioMedia = { images: string[]; video: string | null };

export type DeliverArgs = {
  workspaceId: string;
  actingUserId: string | null;
  item: { id: string; body?: string | null; title?: string | null; meta?: any };
  platform: string;
  placement: "feed" | "reels" | "stories";
  targets: ConnectedAccount[];
  kind: "publish" | "schedule";
  /** Needed to send now; a parked row reads its media again at send time. */
  media: ComposioMedia | null;
};

export type DeliveredRow = { accountId: string; status: string; last_error: string | null };

function baseRow(args: DeliverArgs, accountId: string, now: string) {
  return {
    workspace_id: args.workspaceId,
    content_item_id: args.item.id,
    provider: PROVIDER,
    sdr_post_id: `${PROVIDER}:${args.item.id}`,
    sdr_target_id: accountId,
    account_id: accountId,
    platform: args.platform,
    placement: args.placement,
    frames: null,
    updated_at: now,
  };
}

function postFor(
  item: DeliverArgs["item"],
  placement: DeliverArgs["placement"],
  media: ComposioMedia,
): ComposioPost {
  const link = typeof item.meta?.link_url === "string" ? item.meta.link_url : null;
  return {
    caption: String(item.body ?? ""),
    images: media.images,
    video: media.video,
    link: link && /^https:\/\//.test(link) ? link : null,
    title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : null,
    placement,
  };
}

/** Send to each target now, or park the rows for the scheduled time. */
export async function deliver(args: DeliverArgs): Promise<DeliveredRow[]> {
  const now = new Date().toISOString();
  if (args.kind === "schedule") {
    const rows = args.targets.map((t) => ({
      ...baseRow(args, t.accountId, now),
      status: "pending",
      attempt: 0,
      last_error: null,
      error_code: null,
      error_category: null,
      platform_post_id: null,
      platform_post_url: null,
      delivered_at: null,
      created_at: now,
    }));
    const { error } = await db
      .from("content_publications")
      .upsert(rows, { onConflict: "content_item_id,sdr_target_id" });
    if (error) throw new Error(`Couldn't save the schedule: ${error.message}`);
    return rows.map((r) => ({ accountId: r.account_id, status: "pending", last_error: null }));
  }
  const out: DeliveredRow[] = [];
  for (const target of args.targets) {
    const { data: claimed, error } = await db
      .from("content_publications")
      .upsert(
        {
          ...baseRow(args, target.accountId, now),
          status: "publishing",
          last_error: null,
          error_code: null,
          error_category: null,
          created_at: now,
        },
        { onConflict: "content_item_id,sdr_target_id" },
      )
      .select("id, attempt");
    if (error || !claimed?.[0]) {
      out.push({
        accountId: target.accountId,
        status: "failed",
        last_error: "Couldn't start sending.",
      });
      continue;
    }
    out.push(await sendRow(args, target.accountId, claimed[0].id, claimed[0].attempt ?? 0));
  }
  return out;
}

/** Send one claimed (`publishing`) row and record how it ended. */
async function sendRow(
  args: Pick<
    DeliverArgs,
    "workspaceId" | "actingUserId" | "item" | "platform" | "placement" | "media"
  >,
  accountId: string,
  rowId: string,
  attempt: number,
): Promise<DeliveredRow> {
  const finish = async (patch: Record<string, unknown>): Promise<DeliveredRow> => {
    const now = new Date().toISOString();
    await db
      .from("content_publications")
      .update({ ...patch, attempt: attempt + 1, updated_at: now })
      .eq("id", rowId);
    return {
      accountId,
      status: String(patch.status),
      last_error: (patch.last_error as string | null) ?? null,
    };
  };
  const failed = (message: string, code: string | null = null, category = "platform") =>
    finish({
      status: "failed",
      last_error: message.slice(0, 500),
      error_code: code,
      error_category: category,
    });

  const parsed = parseDestinationAccountId(accountId);
  if (!parsed || !isPublishingPlatform(args.platform)) {
    return failed("This account can't be posted to from Mellox.", "unsupported", "validation");
  }
  const { data: account } = await db
    .from("social_accounts")
    .select("status")
    .eq("workspace_id", args.workspaceId)
    .eq("provider", PROVIDER)
    .eq("provider_account_id", accountId)
    .maybeSingle();
  if (!account || account.status !== "active") {
    return failed(
      "This account isn't connected any more. Reconnect it and try again.",
      "account",
      "auth",
    );
  }
  if (!args.media)
    return failed("The picture couldn't be read from storage.", "media", "validation");

  const plan = planPublish(postFor(args.item, args.placement, args.media), {
    platform: args.platform,
    destination: parsed.destination,
  });
  if (!plan.ok) return failed(plan.reason, "unsupported", "validation");

  const ids: (string | null)[] = [];
  for (const [index, step] of plan.steps.entries()) {
    const resolved = resolveArgs(step.args, ids);
    if (!resolved) return failed("The network didn't return the post it was making.");
    const last = index === plan.steps.length - 1;
    try {
      const stepArgs = await withStagedFiles(resolved, {
        workspaceId: args.workspaceId,
        accountId: parsed.integrationAccountId,
        tool: step.tool,
      });
      const result = await runIntegrationTool({
        workspaceId: args.workspaceId,
        accountId: parsed.integrationAccountId,
        tool: step.tool,
        arguments: stepArgs,
        caller: { kind: "worker", actingUserId: args.actingUserId },
        purpose: "publish",
        approvalRef: `content:${args.item.id}`,
        timeoutMs: last ? PUBLISH_TIMEOUT_MS : 120_000,
      });
      if (!result.successful) {
        return failed(result.error || "The network refused the post.");
      }
      ids.push(resultId(result.data));
    } catch (error) {
      if (error instanceof ComposioGatewayError) {
        if (error.kind === "unknown_outcome" || error.kind === "timeout") {
          // Never resent by itself: it may already be live.
          return failed(
            last
              ? "We couldn't tell whether it posted. Check the account before you retry."
              : "The network took too long. Nothing was posted.",
            last ? "unknown_outcome" : "timeout",
            "transient",
          );
        }
        if (error.kind === "account_auth") {
          return failed(
            "The account needs signing in again. Reconnect it and retry.",
            "account",
            "auth",
          );
        }
        if (error.kind === "rate_limited") {
          return failed(
            "The network is busy. Try again in a few minutes.",
            "rate_limited",
            "transient",
          );
        }
        return failed(error.message);
      }
      return failed(error instanceof Error ? error.message : "Sending failed.");
    }
  }
  const postId = ids[ids.length - 1];
  const now = new Date().toISOString();
  return finish({
    status: "published",
    platform_post_id: postId,
    platform_post_url: postId ? postUrl(args.platform, postId) : null,
    delivered_at: now,
    last_error: null,
    error_code: null,
    error_category: null,
  });
}

// The biggest file handed to a network: a YouTube or LinkedIn video.
const MAX_FILE_BYTES = 512 * 1024 * 1024;

/**
 * Replace every `{ $file }` argument (alone or in a list) with the file put in
 * Composio's store. The bytes come from the post's own signed link, through
 * the SSRF-guarded fetcher. Staging posts nothing, so a failure here is safe.
 */
async function withStagedFiles(
  args: Record<string, unknown>,
  where: { workspaceId: string; accountId: string; tool: string },
): Promise<Record<string, unknown>> {
  const stage = async (value: unknown): Promise<unknown> => {
    if (!isFileArg(value)) return value;
    const { url, name, mimetype } = value.$file;
    const res = await safeFetch(url, {
      timeoutMs: 120_000,
      maxBytes: MAX_FILE_BYTES,
      onOverflow: "error",
    });
    if (!res.ok)
      throw new Error(
        `The ${mimetype.startsWith("video") ? "video" : "picture"} couldn't be read from storage.`,
      );
    return stageIntegrationFile({ ...where, name, mimetype, bytes: res.bytes });
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = Array.isArray(value) ? await Promise.all(value.map(stage)) : await stage(value);
  }
  return out;
}

// ── Retry, cancel ─────────────────────────────────────────────────────────

/** Resend an item's failed Composio rows (a person's click). */
export async function retryFailed(args: {
  workspaceId: string;
  actingUserId: string | null;
  item: DeliverArgs["item"] & { status?: string };
  media: ComposioMedia | null;
}): Promise<DeliveredRow[]> {
  const { data: rows } = await db
    .from("content_publications")
    .select("id, account_id, platform, placement, attempt")
    .eq("workspace_id", args.workspaceId)
    .eq("content_item_id", args.item.id)
    .eq("provider", PROVIDER)
    .eq("status", "failed");
  const out: DeliveredRow[] = [];
  for (const row of rows ?? []) {
    const { data: claimed } = await db
      .from("content_publications")
      .update({ status: "publishing", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "failed")
      .select("id");
    if (!claimed?.length) continue;
    out.push(
      await sendRow(
        { ...args, platform: row.platform, placement: row.placement ?? "feed" },
        row.account_id,
        row.id,
        row.attempt ?? 0,
      ),
    );
  }
  return out;
}

/** Cancel an item's parked Composio rows. Returns how many were cancelled. */
export async function cancelPending(workspaceId: string, itemId: string): Promise<number> {
  const { data } = await db
    .from("content_publications")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("content_item_id", itemId)
    .eq("provider", PROVIDER)
    .eq("status", "pending")
    .select("id");
  return Array.isArray(data) ? data.length : 0;
}

/** Does this item have Composio rows (parked or failed)? */
export async function hasComposioRows(
  workspaceId: string,
  itemId: string,
  status: "pending" | "failed",
): Promise<boolean> {
  const { data } = await db
    .from("content_publications")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("content_item_id", itemId)
    .eq("provider", PROVIDER)
    .eq("status", status)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

// ── Scheduled posts ───────────────────────────────────────────────────────

export type DueDeps = {
  /** The item's pictures or video as public links, read now. */
  mediaFor: (item: any) => Promise<ComposioMedia | null>;
  /** Move the item's status from its rows (recomputeSocialItemStatus). */
  recompute: (itemId: string) => Promise<unknown>;
  now?: () => number;
};

/** Send parked rows whose item's time has come. From the run-schedules hook. */
export async function runDueComposioPublications(
  deps: DueDeps,
  opts: { max?: number; budgetMs?: number } = {},
): Promise<{ sent: number; failed: number; cancelled: number }> {
  const started = Date.now();
  const now = deps.now?.() ?? Date.now();
  // A send cut off midway (a restart, a timeout) is never resent by itself:
  // it may already be live. It fails with a plain reason; Retry is a click.
  const { data: stuck } = await db
    .from("content_publications")
    .update({
      status: "failed",
      error_code: "unknown_outcome",
      error_category: "transient",
      last_error: "We couldn't tell whether it posted. Check the account before you retry.",
      updated_at: new Date(now).toISOString(),
    })
    .eq("provider", PROVIDER)
    .eq("status", "publishing")
    .lt("updated_at", new Date(now - STUCK_AFTER_MS).toISOString())
    .select("content_item_id");
  for (const row of stuck ?? []) await deps.recompute(row.content_item_id).catch(() => undefined);

  const { data: rows, error } = await db
    .from("content_publications")
    .select("id, workspace_id, content_item_id, account_id, platform, placement, attempt")
    .eq("provider", PROVIDER)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`Couldn't read scheduled posts: ${error.message}`);
  const itemIds = [...new Set((rows ?? []).map((r: any) => r.content_item_id))];
  if (!itemIds.length) return { sent: 0, failed: 0, cancelled: 0 };
  const { data: items } = await db
    .from("content_items")
    .select("id, workspace_id, status, scheduled_at, body, title, meta, media_url")
    .in("id", itemIds);
  const byId = new Map<string, any>((items ?? []).map((i: any) => [i.id, i]));

  let sent = 0;
  let failedCount = 0;
  let cancelled = 0;
  const touched = new Set<string>();
  const media = new Map<string, ComposioMedia | null>();
  for (const row of rows ?? []) {
    if (sent + failedCount >= (opts.max ?? 20)) break;
    if (Date.now() - started > (opts.budgetMs ?? 60_000)) break;
    const item = byId.get(row.content_item_id);
    if (!item || item.workspace_id !== row.workspace_id || item.status !== "scheduled") {
      // Unscheduled, edited back to draft, or removed: never sent.
      await db
        .from("content_publications")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", "pending");
      cancelled++;
      if (item) touched.add(item.id);
      continue;
    }
    const due = Date.parse(item.scheduled_at ?? "");
    if (!Number.isFinite(due) || due > now) continue;
    const { data: claimed } = await db
      .from("content_publications")
      .update({ status: "publishing", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");
    if (!claimed?.length) continue;
    if (!media.has(item.id)) media.set(item.id, await deps.mediaFor(item).catch(() => null));
    const { data: program } = await db
      .from("social_accounts")
      .select("connected_by")
      .eq("provider", PROVIDER)
      .eq("provider_account_id", row.account_id)
      .maybeSingle();
    const result = await sendRow(
      {
        workspaceId: row.workspace_id,
        actingUserId: program?.connected_by ?? null,
        item,
        platform: row.platform,
        placement: row.placement ?? "feed",
        media: media.get(item.id) ?? null,
      },
      row.account_id,
      row.id,
      row.attempt ?? 0,
    );
    if (result.status === "published") sent++;
    else failedCount++;
    touched.add(item.id);
  }
  for (const id of touched) await deps.recompute(id).catch(() => undefined);
  return { sent, failed: failedCount, cancelled };
}
