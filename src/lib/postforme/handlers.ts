// handlers.ts — Post for Me distribution handlers. Pure and dependency-injected
// (provider client, Supabase-like db, workspace id, plan quota).
//
// Tenant isolation: every account operation is checked against
// GET /social-accounts?external_id=<workspace id>. An account id from the
// browser is never trusted until the provider lists it under that workspace.
//
// Delivery bookkeeping reuses the SDR pipeline tables: one content_publications
// row per (content item × target account), sdr_post_id = Post for Me post id,
// sdr_target_id = account id, provider = 'postforme'.
//
// Placement: every row records where it went (feed / reels / stories). A Story
// row also records its frames (src/lib/stories/results.ts): one Story per
// media item at the provider, tracked individually so a row is published only
// when every frame went out and a retry resends only the frames that failed.
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import {
  socialApiErrorResponse as baseProviderErrorResponse,
  socialApiTransportError,
  type DistributionErrorCode,
  type SocialApiCall,
  type SocialApiResponse,
} from "@/lib/socialapi/client.server";
import {
  canTransitionContent,
  isContentStatus,
  mergeMeta,
  type ContentStatus,
} from "@/lib/content-lifecycle";
import { aggregateItemStatus } from "@/lib/sdr.webhook";
import { resolveTargetAccounts } from "@/lib/sdr.targets";
import {
  DISTRIBUTION_PLATFORMS,
  PROVIDER_PLATFORMS,
  isDistributionPlatform,
  type DistributionPlatformId,
} from "@/lib/distribution-platforms";
import type {
  ConnectedAccount,
  PublishOutcome,
  PublishSelection,
  ScheduleItem,
} from "@/lib/sdr.handlers";
import {
  cleanMentions,
  isStoryItem,
  placementForItem,
  supportsPlacement,
  toProviderPlacement,
  type Placement,
} from "@/lib/stories/placement";
import {
  framePostIds,
  framesToRetry,
  initialFrames,
  markRetried,
  mergeFrames,
  readFrames,
  rowOutcome,
  type FrameResult,
  type FrameStatus,
} from "@/lib/stories/results";
import {
  combineFrames,
  holdRate,
  storyMetricsFrom,
  type StoryMetrics,
} from "@/lib/stories/metrics";

// ─── Shared shapes ──────────────────────────────────────────────────────────
export type HandlerResult<T = any> = { status: number; body: T };

function socialApiErrorResponse(res: SocialApiResponse<unknown>) {
  const mapped = baseProviderErrorResponse(res);
  if (mapped.body.error.code === "PROVIDER_MISCONFIGURED") {
    mapped.body.error.detail =
      "Post for Me rejected the project API key. Check the server configuration.";
  }
  return mapped;
}

export type PostQuota = {
  check(workspaceId: string, needed: number): Promise<{ ok: boolean; used: number; limit: number }>;
  record(event: {
    workspaceId: string;
    operation: "publish" | "schedule" | "retry";
    providerPostId: string | null;
    contentItemId: string | null;
    userId: string | null;
    targets: number;
  }): Promise<void>;
};

export type SocialApiDeps = {
  api: SocialApiCall;
  db: any;
  /** Mellox workspace id, passed as Post for Me external_id. */
  brandId: string;
  quota?: PostQuota;
  now?: () => number;
  fetchFn?: typeof fetch;
  /**
   * A designed piece's images in order, redrawn first if its words changed:
   * a carousel's slides (src/server/studio/carousel-assets.server.ts) or a
   * Story's frames (src/server/studio/story-assets.server.tsx). Null for
   * anything else.
   */
  designedMedia?: (item: any) => Promise<string[] | null>;
  /** The Stories flag for this workspace; false holds Story items back. */
  storiesEnabled?: boolean;
};

export class DistributionError extends Error {
  constructor(
    public status: number,
    public code: DistributionErrorCode | "DISTRIBUTION_DISABLED",
    message: string,
  ) {
    super(message);
    this.name = "DistributionError";
  }
}

export function distributionErrorResponse(e: unknown): HandlerResult {
  if (e instanceof DistributionError) {
    return { status: e.status, body: { error: { code: e.code, detail: e.message } } };
  }
  return socialApiTransportError(e);
}

function fail(status: number, code: string, detail: string): HandlerResult {
  return { status, body: { error: { code, detail } } };
}

const nowMs = (deps: { now?: () => number }) => deps.now?.() ?? Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const label = (platform: string) =>
  isDistributionPlatform(platform) ? DISTRIBUTION_PLATFORMS[platform].label : platform;

/** Provider post object (subset of the documented Post schema we rely on). */
export type ProviderTarget = {
  account_id: string;
  platform?: string;
  status?: string;
  platform_post_id?: string | null;
  permalink?: string | null;
  error?: { category?: string; code?: string; message?: string } | null;
  metrics?: { likes?: number; comments?: number; shares?: number; saves?: number; extra?: any };
  /** Which of the account's media items this result is for (Stories), when known. */
  frame?: number | null;
  /** Per-frame numbers by the network's post id (Stories). */
  frames?: { platform_post_id?: string; posted_at?: string | null; metrics?: unknown }[];
};
export type ProviderPost = {
  id: string;
  status?: string;
  text?: string;
  scheduled_at?: string | null;
  retry_count?: number;
  targets?: ProviderTarget[];
};

// ─── Accounts ───────────────────────────────────────────────────────────────
type ProviderAccount = {
  id: string;
  platform: string;
  name?: string;
  username?: string;
  brand_id?: string;
  status?: string;
  reconnect_reason?: string;
  profile_picture_url?: string;
};

export function mapSocialApiAccount(a: ProviderAccount): ConnectedAccount {
  return {
    accountId: a.id,
    platform: a.platform,
    platformUsername: a.username || a.name || "",
    displayName: a.name || null,
    avatarUrl: a.profile_picture_url || null,
    status: a.status === "active" ? "active" : "expired",
    reconnectReason: a.reconnect_reason || null,
    tokenExpiresAt: null,
    provider: "postforme",
  };
}

type AccountsFetch = { ok: true; accounts: ConnectedAccount[] } | { ok: false; res: HandlerResult };

/** The brand's publishable-platform accounts, straight from the provider. */
export async function fetchBrandAccounts(deps: SocialApiDeps): Promise<AccountsFetch> {
  const res = await deps.api<{ data?: ProviderAccount[] }>({
    path: "/accounts",
    query: { brand_id: deps.brandId },
    retry: true,
  });
  if (res.status !== 200) return { ok: false, res: socialApiErrorResponse(res) };
  const accounts = (res.data?.data ?? [])
    // The query filter is the provider's; this check is ours. An account that
    // is not under this workspace's brand is never shown or targeted.
    .filter((a) => a && a.brand_id === deps.brandId && isDistributionPlatform(a.platform))
    .map(mapSocialApiAccount);
  return { ok: true, accounts };
}

/** Mirror the provider's account list into social_accounts (best effort). */
export async function syncAccountMirror(
  deps: SocialApiDeps,
  workspaceId: string,
  accounts: ConnectedAccount[],
  extra: { connectedBy?: string | null; connectedAccountId?: string | null } = {},
): Promise<void> {
  const now = iso(nowMs(deps));
  try {
    if (accounts.length) {
      const rows = accounts.map((a) => ({
        workspace_id: workspaceId,
        provider: "postforme",
        provider_account_id: a.accountId,
        brand_id: deps.brandId,
        platform: a.platform,
        username: a.platformUsername || null,
        display_name: a.displayName ?? null,
        avatar_url: a.avatarUrl ?? null,
        status: a.status === "active" ? "active" : "reconnect_required",
        reconnect_reason: a.reconnectReason ?? null,
        disconnected_at: null,
        last_synced_at: now,
        updated_at: now,
        ...(extra.connectedAccountId === a.accountId
          ? { connected_by: extra.connectedBy ?? null, connected_at: now }
          : {}),
      }));
      const { error } = await deps.db
        .from("social_accounts")
        .upsert(rows, { onConflict: "provider,provider_account_id" });
      if (error) console.error("[postforme] account mirror upsert failed", error.message);
    }
    // The provider hard-deletes disconnected accounts, so absence = disconnected.
    let stale = deps.db
      .from("social_accounts")
      .update({ status: "disconnected", disconnected_at: now, updated_at: now })
      .eq("workspace_id", workspaceId)
      .eq("provider", "postforme")
      .neq("status", "disconnected");
    if (accounts.length) {
      const list = accounts.map((a) => `"${a.accountId.replace(/["\\]/g, "")}"`).join(",");
      stale = stale.not("provider_account_id", "in", `(${list})`);
    }
    const { error } = await stale;
    if (error) console.error("[postforme] account mirror prune failed", error.message);
  } catch (e) {
    console.error("[postforme] account mirror sync failed", e instanceof Error ? e.message : e);
  }
}

export async function listAccountsHandler(
  workspaceId: string,
  deps: SocialApiDeps,
): Promise<HandlerResult> {
  try {
    const fetched = await fetchBrandAccounts(deps);
    if (!fetched.ok) return fetched.res;
    await syncAccountMirror(deps, workspaceId, fetched.accounts);
    return { status: 200, body: fetched.accounts };
  } catch (e) {
    return distributionErrorResponse(e);
  }
}

// ─── Connect (managed OAuth) ────────────────────────────────────────────────
// Quickstart projects return to the redirect configured in the dashboard.
export async function startConnectHandler(
  args: { platform: string },
  deps: SocialApiDeps,
): Promise<HandlerResult> {
  if (!(PROVIDER_PLATFORMS.postforme as string[]).includes(args.platform)) {
    return fail(400, "PLATFORM_VALIDATION", `Unsupported platform: ${args.platform}`);
  }
  try {
    // Quickstart projects use their dashboard redirect and do not accept a
    // per-request redirect override or application state parameter.
    const res = await deps.api<{ auth_url?: string }>({
      method: "POST",
      path: "/accounts/connect",
      body: { platform: args.platform },
    });
    if (res.status === 202 && typeof res.data?.auth_url === "string") {
      let url: URL | null = null;
      try {
        url = new URL(res.data.auth_url);
      } catch {
        url = null;
      }
      if (!url || url.protocol !== "https:") {
        return fail(
          502,
          "DISTRIBUTION_UNAVAILABLE",
          "The provider returned an invalid authorization link.",
        );
      }
      return {
        status: 200,
        body: { authorizationUrl: url.toString() },
      };
    }
    return socialApiErrorResponse(res);
  } catch (e) {
    return distributionErrorResponse(e);
  }
}

// Post for Me returns account connection results through the project redirect.

export async function disconnectHandler(
  args: { workspaceId: string; accountId: string },
  deps: SocialApiDeps,
): Promise<HandlerResult> {
  if (!args.accountId) return fail(400, "PLATFORM_VALIDATION", "accountId required");
  try {
    const fetched = await fetchBrandAccounts(deps);
    if (!fetched.ok) return fetched.res;
    if (!fetched.accounts.some((a) => a.accountId === args.accountId)) {
      return fail(404, "NOT_FOUND", "Account not found");
    }
    const res = await deps.api({
      method: "DELETE",
      path: `/accounts/${encodeURIComponent(args.accountId)}`,
      retry: true,
    });
    // 404 after a retried DELETE means the first attempt already removed it.
    if (res.status !== 204 && res.status !== 200 && res.status !== 404) {
      return socialApiErrorResponse(res);
    }
    await syncAccountMirror(
      deps,
      args.workspaceId,
      fetched.accounts.filter((a) => a.accountId !== args.accountId),
    );
    return { status: 204, body: null };
  } catch (e) {
    return distributionErrorResponse(e);
  }
}

export async function creatorInfoHandler(
  args: { accountId: string },
  deps: SocialApiDeps,
): Promise<HandlerResult> {
  try {
    const fetched = await fetchBrandAccounts(deps);
    if (!fetched.ok) return fetched.res;
    const account = fetched.accounts.find((a) => a.accountId === args.accountId);
    if (!account) return fail(404, "NOT_FOUND", "Account not found");
    if (account.platform !== "tiktok")
      return { status: 200, body: { privacyLevels: [], canPost: true } };
    const res = await deps.api<any>({
      path: `/accounts/${encodeURIComponent(args.accountId)}/creator-info`,
      retry: true,
    });
    if (res.status !== 200) return socialApiErrorResponse(res);
    return {
      status: 200,
      body: {
        privacyLevels: Array.isArray(res.data?.privacy_level_options)
          ? res.data.privacy_level_options.map(String)
          : [],
        canPost: res.data?.can_post !== false,
        maxVideoDurationSec: res.data?.max_video_duration_sec ?? null,
      },
    };
  } catch (e) {
    return distributionErrorResponse(e);
  }
}

// ─── Content-item status (lifecycle-safe) ───────────────────────────────────
/**
 * Move an item to `next` only along legal lifecycle edges (the DB trigger
 * enforces the same table), stepping through `approved` when a direct edge
 * doesn't exist (failed → approved → publishing). Returns the final status.
 */
export async function moveItemStatus(
  db: any,
  itemId: string,
  from: string,
  next: string,
  patch: Record<string, unknown> = {},
): Promise<string> {
  const hasPatch = Object.keys(patch).length > 0;
  if (from === next) {
    if (hasPatch) {
      const { error } = await db.from("content_items").update(patch).eq("id", itemId);
      if (error) console.error("[postforme] item update failed", itemId, error.message);
    }
    return from;
  }
  if (!isContentStatus(from) || !isContentStatus(next)) return from;
  const steps: ContentStatus[] = canTransitionContent(from, next)
    ? [next]
    : canTransitionContent(from, "approved") && canTransitionContent("approved", next)
      ? ["approved", next]
      : [];
  if (!steps.length) {
    console.warn(`[postforme] item ${itemId}: no legal path ${from} → ${next}`);
    if (hasPatch) await db.from("content_items").update(patch).eq("id", itemId);
    return from;
  }
  let current: string = from;
  for (const [i, status] of steps.entries()) {
    const last = i === steps.length - 1;
    const { error } = await db
      .from("content_items")
      .update({ status, ...(last ? patch : {}) })
      .eq("id", itemId);
    if (error) {
      console.error(`[postforme] item ${itemId}: ${current} → ${status} refused`, error.message);
      return current;
    }
    current = status;
  }
  return current;
}

/** Recompute an item's editorial status from its Post for Me delivery rows. */
export async function recomputeSocialItemStatus(db: any, itemId: string): Promise<string | null> {
  const [{ data: item }, { data: rows }] = await Promise.all([
    db.from("content_items").select("id, status").eq("id", itemId).maybeSingle(),
    db.from("content_publications").select("status").eq("content_item_id", itemId),
  ]);
  if (!item || !Array.isArray(rows) || rows.length === 0) return item?.status ?? null;
  const active = rows.filter((r: { status: string }) => r.status !== "cancelled");
  // A scheduled post's deliveries are `pending` until it fires: still scheduled.
  if (
    item.status === "scheduled" &&
    active.length > 0 &&
    active.every((r: { status: string }) => r.status === "pending")
  ) {
    return "scheduled";
  }
  return moveItemStatus(db, itemId, item.status, aggregateItemStatus(rows));
}

// ─── Post → delivery rows ───────────────────────────────────────────────────
const TERMINAL = new Set(["published", "failed", "cancelled"]);

function targetStatus(t: ProviderTarget, post: ProviderPost): string {
  if (post.status === "cancelled") return "cancelled";
  switch (t.status) {
    case "published":
      return "published";
    case "failed":
      return "failed";
    case "publishing":
      return "publishing";
    default:
      // `pending`: waiting for the schedule, or queued for immediate delivery.
      return post.status === "scheduled" || post.status === "draft" ? "pending" : "publishing";
  }
}

function rowPatchFor(
  t: ProviderTarget,
  post: ProviderPost,
  status: string,
  now: string,
  prev?: any,
) {
  const patch: Record<string, unknown> = {
    status,
    attempt: Math.max(post.retry_count ?? 0, prev?.attempt ?? 0),
    updated_at: now,
  };
  if (status === "published") {
    patch.platform_post_id = t.platform_post_id ?? prev?.platform_post_id ?? null;
    patch.platform_post_url = t.permalink ?? prev?.platform_post_url ?? null;
    patch.delivered_at = prev?.delivered_at ?? now;
    patch.error_category = null;
    patch.error_code = null;
    patch.last_error = null;
  } else if (status === "failed") {
    patch.error_category = t.error?.category ?? null;
    patch.error_code = t.error?.code ?? null;
    patch.last_error = t.error?.message ?? "The platform rejected this post.";
  } else if (status === "publishing" || status === "pending") {
    patch.error_category = null;
    patch.error_code = null;
    patch.last_error = null;
  }
  return patch;
}

/**
 * Apply a provider post snapshot (from a create response, a webhook `results`
 * array, or GET /posts/{id}) to its delivery rows. Terminal-wins: a published
 * row never regresses; a failed row returns to publishing only when the
 * provider's retry_count shows a newer attempt. Returns touched item ids.
 */
export async function applyPostSnapshot(
  db: any,
  post: ProviderPost,
  opts: { now: string; workspaceId?: string },
): Promise<string[]> {
  let query = db
    .from("content_publications")
    .select("*")
    .eq("provider", "postforme")
    .eq("sdr_post_id", post.id);
  if (opts.workspaceId) query = query.eq("workspace_id", opts.workspaceId);
  const { data: rows } = await query;
  const touched = new Set<string>();
  for (const row of (rows ?? []) as any[]) {
    const frames = readFrames(row.frames);
    if (frames) {
      const patch = storyRowPatch(row, frames, post, opts.now);
      if (!patch) continue;
      const { error } = await db.from("content_publications").update(patch).eq("id", row.id);
      if (error) {
        console.error("[postforme] story row update failed", row.id, error.message);
        continue;
      }
      touched.add(row.content_item_id);
      continue;
    }
    const t = (post.targets ?? []).find((x) => x.account_id === row.sdr_target_id);
    const next = t ? targetStatus(t, post) : post.status === "cancelled" ? "cancelled" : null;
    if (!next) continue;
    if (row.status === "published" && next !== "published") continue;
    if (row.status === "cancelled" && next !== "published") continue;
    if (
      row.status === "failed" &&
      !TERMINAL.has(next) &&
      (post.retry_count ?? 0) <= (row.attempt ?? 0)
    ) {
      continue;
    }
    const changed =
      row.status !== next ||
      (t?.permalink && t.permalink !== row.platform_post_url) ||
      (t?.error?.message && t.error.message !== row.last_error);
    if (!changed) continue;
    const patch = t
      ? rowPatchFor(t, post, next, opts.now, row)
      : { status: next, updated_at: opts.now };
    const { error } = await db.from("content_publications").update(patch).eq("id", row.id);
    if (error) {
      console.error("[postforme] delivery row update failed", row.id, error.message);
      continue;
    }
    touched.add(row.content_item_id);
  }
  return [...touched];
}

// ─── Story frames ───────────────────────────────────────────────────────────
function frameStatusOf(t: ProviderTarget, post: ProviderPost): FrameStatus {
  const s = targetStatus(t, post);
  return s === "cancelled" ? "failed" : (s as FrameStatus);
}

/** A provider snapshot applied to one account's frames. */
export function framesFromSnapshot(
  frames: FrameResult[],
  post: ProviderPost,
  accountId: string,
): FrameResult[] {
  const mine = (post.targets ?? []).filter((t) => t.account_id === accountId);
  // Only settled results say anything about a particular frame; an account
  // listed without results is still waiting for all of its frames.
  const settled = mine
    .filter((t) => t.status === "published" || t.status === "failed")
    .map((t) => ({
      frame: t.frame ?? null,
      status: frameStatusOf(t, post),
      platformPostId: t.platform_post_id ?? null,
      permalink: t.permalink ?? null,
      error: t.error?.message ?? null,
    }));
  const fallback =
    post.status === "cancelled"
      ? { status: "failed" as const, error: "The Story was removed before it went out." }
      : {
          status: (post.status === "scheduled" || post.status === "draft"
            ? "pending"
            : "publishing") as FrameStatus,
        };
  return mergeFrames(frames, post.id, settled, fallback);
}

function storyRowPatch(row: any, frames: FrameResult[], post: ProviderPost, now: string) {
  const next = framesFromSnapshot(frames, post, row.sdr_target_id);
  const outcome = rowOutcome(next);
  const unresolved =
    (post.status === "published" || post.status === "failed") &&
    next.some((frame) => frame.status === "publishing") &&
    (post.targets ?? []).some(
      (target) =>
        target.account_id === row.sdr_target_id &&
        (target.status === "published" || target.status === "failed") &&
        target.frame == null,
    );
  const unresolvedMessage =
    "Post for Me did not identify every Story frame. Check the account before creating another Story.";
  // Deleted upstream before anything went out: cancelled, like a post.
  const status =
    post.status === "cancelled" && outcome.sent === 0 && row.status !== "failed"
      ? "cancelled"
      : unresolved
        ? "failed"
        : outcome.status;
  if (row.status === "published" && status !== "published") return null;
  const changed =
    status !== row.status ||
    JSON.stringify(next) !== JSON.stringify(frames) ||
    (unresolved ? unresolvedMessage : (outcome.error ?? null)) !== (row.last_error ?? null);
  if (!changed) return null;
  return {
    status,
    frames: next,
    updated_at: now,
    platform_post_id: outcome.platformPostId ?? row.platform_post_id ?? null,
    platform_post_url: outcome.permalink ?? row.platform_post_url ?? null,
    ...(status === "published" ? { delivered_at: row.delivered_at ?? now } : {}),
    last_error: status === "failed" ? (unresolved ? unresolvedMessage : outcome.error) : null,
    error_category: status === "failed" ? (row.error_category ?? "platform") : null,
    error_code: null,
  };
}

/** Delivery rows for a freshly created post: one per account, Stories with their frames. */
function deliveryRows(args: {
  workspaceId: string;
  contentItemId: string;
  platform: string;
  placement: Placement | null;
  frameCount: number | null;
  frameSources?: string[];
  post: ProviderPost;
  targets: ProviderTarget[];
  now: string;
}) {
  const { post, now } = args;
  const byAccount = new Map<string, ProviderTarget[]>();
  for (const t of args.targets)
    byAccount.set(t.account_id, [...(byAccount.get(t.account_id) ?? []), t]);
  return [...byAccount.entries()].map(([accountId, list]) => {
    const t = list[0];
    const base = {
      workspace_id: args.workspaceId,
      content_item_id: args.contentItemId,
      provider: "postforme",
      sdr_post_id: post.id,
      sdr_target_id: accountId,
      platform: t.platform ?? args.platform,
      account_id: accountId,
      placement: args.placement ?? "feed",
      created_at: now,
      platform_post_id: null as string | null,
      platform_post_url: null as string | null,
      delivered_at: null as string | null,
      error_category: null as string | null,
      error_code: null as string | null,
      metrics: null,
      metrics_synced_at: null,
    };
    if (args.frameCount) {
      const start = initialFrames(
        args.frameCount,
        post.id,
        post.status === "scheduled" || post.status === "draft" ? "pending" : "publishing",
      ).map((frame) => ({ ...frame, source: args.frameSources?.[frame.i] ?? null }));
      const frames = framesFromSnapshot(start, post, accountId);
      const outcome = rowOutcome(frames);
      return {
        ...base,
        attempt: post.retry_count ?? 0,
        updated_at: now,
        frames,
        status: outcome.status as string,
        platform_post_id: outcome.platformPostId,
        platform_post_url: outcome.permalink,
        delivered_at: outcome.status === "published" ? now : null,
        last_error: outcome.status === "failed" ? outcome.error : null,
        error_category: outcome.status === "failed" ? "platform" : null,
      };
    }
    const status = targetStatus(t, post);
    return {
      ...base,
      frames: null,
      ...rowPatchFor(t, post, status, now),
      status,
      last_error:
        t.status === "failed" ? (t.error?.message ?? "The platform rejected this post.") : null,
    };
  });
}

// ─── Media ──────────────────────────────────────────────────────────────────
type MediaSource = {
  source_type: "url" | "media_id";
  source: string;
  /** Instagram user tags; on a Story they need no position. */
  tags?: { id: string; platform: "instagram"; type: "user" }[];
  thumbnail_timestamp_ms?: number;
};
const SERVER_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const STORAGE_BUCKET = "generated-assets";

/** The item's stored asset path — only when it lies inside the item's own workspace. */
function storagePathOf(item: any): string | null {
  const p = item?.meta?.asset_storage_path;
  return isWorkspaceStoragePath(p, item?.workspace_id) ? (p as string) : null;
}

/**
 * Every stored image of the item, in order: a carousel's slides when it has
 * them, else its single asset. Each path must lie in the item's own workspace.
 */
function storagePathsOf(item: any): string[] {
  const many = item?.meta?.asset_storage_paths;
  if (
    Array.isArray(many) &&
    many.length > 1 &&
    many.length <= 20 &&
    many.every((p) => isWorkspaceStoragePath(p, item?.workspace_id))
  ) {
    return many as string[];
  }
  const one = storagePathOf(item);
  return one ? [one] : [];
}

/** meta names a storage path that is not this workspace's (tampered or copied meta). */
function hasForeignStoragePath(item: any): boolean {
  const p = item?.meta?.asset_storage_path;
  return typeof p === "string" && p !== "" && !isWorkspaceStoragePath(p, item?.workspace_id);
}

/**
 * A provider post id from item meta is only acted on when this workspace's own
 * delivery rows for this item recorded it. meta is user-editable; the
 * Post for Me key is shared by every workspace, so without this a foreign post
 * id could be published, moved, cancelled or retried.
 */
async function ownsProviderPost(
  db: any,
  workspaceId: string,
  contentItemId: string,
  postId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("content_publications")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("content_item_id", contentItemId)
    .eq("provider", "postforme")
    .eq("sdr_post_id", postId)
    .limit(1);
  return !error && Array.isArray(data) && data.length > 0;
}

const FOREIGN_POST = "This item's provider post doesn't belong to this workspace.";

function publicMediaUrl(item: any): string | null {
  const raw = typeof item?.media_url === "string" ? item.media_url : "";
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Short-lived URL good enough for validation and immediate publishing. */
async function signedUrl(db: any, path: string): Promise<string | null> {
  const { data, error } = await db.storage.from(STORAGE_BUCKET).createSignedUrl(path, 3600);
  return error ? null : (data?.signedUrl ?? null);
}

/**
 * Copy a stored asset into the provider's media library. Used for scheduled
 * posts: a signed URL would expire before the schedule fires, and the provider
 * fetches `url` sources at publish time.
 */
async function uploadStoredAsset(
  deps: SocialApiDeps,
  path: string,
): Promise<{ ok: true; mediaId: string } | { ok: false; reason: string }> {
  const { data: blob, error } = await deps.db.storage.from(STORAGE_BUCKET).download(path);
  if (error || !blob)
    return { ok: false, reason: "The attached media couldn't be read from storage." };
  const filename = path.split("/").pop() || "media";
  const type = (blob as Blob).type || "application/octet-stream";

  if ((blob as Blob).size <= SERVER_UPLOAD_MAX_BYTES) {
    const form = new FormData();
    form.append("file", blob as Blob, filename);
    const res = await deps.api<{ media_id?: string }>({
      method: "POST",
      path: "/media/upload",
      form,
      timeoutMs: 120_000,
    });
    if (res.status === 201 && res.data?.media_id) return { ok: true, mediaId: res.data.media_id };
    return {
      ok: false,
      reason: (res.data as any)?.error?.message ?? `Media upload failed (${res.status}).`,
    };
  }

  // Large files: presigned PUT, then the mandatory verify step.
  const presign = await deps.api<{ media_id?: string; upload_url?: string }>({
    path: "/media/upload-url",
    query: { media_type: type, filename },
    retry: true,
  });
  if (presign.status !== 200 || !presign.data?.upload_url || !presign.data.media_id) {
    return { ok: false, reason: "The provider couldn't prepare a media upload." };
  }
  const put = await (deps.fetchFn ?? fetch)(presign.data.upload_url, {
    method: "PUT",
    headers: { "Content-Type": type },
    body: blob as Blob,
  });
  if (!put.ok) return { ok: false, reason: `Media upload failed (${put.status}).` };
  const verify = await deps.api({
    method: "POST",
    path: `/media/${encodeURIComponent(presign.data.media_id)}/verify`,
    retry: true,
  });
  if (verify.status !== 200)
    return { ok: false, reason: "The uploaded media couldn't be verified." };
  return { ok: true, mediaId: presign.data.media_id };
}

// ─── Publish / schedule ─────────────────────────────────────────────────────
export type SocialPublishOutcome = PublishOutcome & {
  providerPostId?: string;
  scheduledAt?: string;
};

type Entry = { contentItemId: string; scheduledAt?: string };

const CLAIM_LOST = "This content changed while it was being sent. Refresh and try again.";

/** Promote draft/failed/published items to approved (an explicit send is consent). */
async function promoteForDistribution(
  db: any,
  item: any,
  target: "publishing" | "scheduled",
): Promise<string | null> {
  const from = String(item.status ?? "");
  if (from === "publishing") return "This content is already being published";
  if (isContentStatus(from) && canTransitionContent(from, target)) return null;
  const path: ContentStatus[] =
    from === "published"
      ? ["draft", "approved"]
      : from === "draft" || from === "failed" || from === "partial_failed"
        ? ["approved"]
        : [];
  if (!path.length) {
    return `Content in status "${from}" can't be ${target === "publishing" ? "published" : "scheduled"}`;
  }
  for (const status of path) {
    const { data, error } = await db
      .from("content_items")
      .update({ status })
      .eq("id", item.id)
      .eq("status", item.status)
      .select("id");
    if (error) return `Couldn't approve content before distribution: ${error.message}`;
    if (!Array.isArray(data) || data.length === 0) return CLAIM_LOST;
    item.status = status;
  }
  return null;
}

/** Conditional status write: succeeds only if nobody changed the item meanwhile. */
async function claimItem(
  db: any,
  item: any,
  target: "publishing" | "scheduled",
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const { data, error } = await db
    .from("content_items")
    .update({ status: target, ...extra })
    .eq("id", item.id)
    .eq("status", item.status)
    .select("id");
  if (error) {
    console.error("[postforme] claim failed", item.id, error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * After a transport failure on POST /posts, look up the exact external ID used
 * for that attempt before declaring failure. This prevents a later click from
 * duplicating a post that the provider accepted before the timeout.
 */
async function findAcceptedPost(
  deps: SocialApiDeps,
  accountIds: string[],
  externalId: string,
): Promise<ProviderPost | null> {
  try {
    const res = await deps.api<{ data?: ProviderPost[] }>({
      path: "/posts",
      query: {
        account_ids: accountIds.join(","),
        external_id: externalId,
      },
      retry: true,
    });
    if (res.status !== 200) return null;
    return (res.data?.data ?? [])[0] ?? null;
  } catch {
    return null;
  }
}

function youtubeTitle(item: any): string {
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const fallback = String(item.body ?? "")
    .split("\n")[0]
    .trim();
  return (title || fallback).slice(0, 100);
}

async function distribute(
  kind: "publish" | "schedule",
  args: {
    workspaceId: string;
    userId: string | null;
    entries: Entry[];
    selection: PublishSelection;
    tiktokPrivacyLevel?: string | null;
  },
  deps: SocialApiDeps,
): Promise<HandlerResult> {
  const fetched = await fetchBrandAccounts(deps);
  if (!fetched.ok) return fetched.res;
  const accounts = fetched.accounts;
  const results: SocialPublishOutcome[] = [];
  const skip = (contentItemId: string, reason: string) =>
    results.push({ contentItemId, status: "skipped", reason });

  for (const entry of args.entries) {
    const id = entry.contentItemId;
    let utc: string | undefined;
    if (kind === "schedule") {
      const t = Date.parse(entry.scheduledAt ?? "");
      if (Number.isNaN(t)) {
        skip(id, "Invalid scheduled time");
        continue;
      }
      if (t <= nowMs(deps) + 60_000 || t - nowMs(deps) > 365 * 24 * 3600 * 1000) {
        skip(id, "Scheduled time must be at least a minute ahead and within 1 year");
        continue;
      }
      utc = iso(t);
    }

    const { data: item } = await deps.db
      .from("content_items")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    if (!item) return fail(404, "NOT_FOUND", `Content item not found: ${id}`);

    if (["pending", "rejected", "cancelled"].includes(item.status)) {
      return fail(
        403,
        "PLATFORM_VALIDATION",
        `Content must be approved before ${kind === "publish" ? "publishing" : "scheduling"}`,
      );
    }

    const platform = item.meta?.platform as string | undefined;
    if (!platform || !(PROVIDER_PLATFORMS.postforme as string[]).includes(platform)) {
      skip(id, `No deliverable platform (${platform ?? "none"})`);
      continue;
    }
    const story = isStoryItem(item);
    const placement = placementForItem(item);
    if (story && deps.storiesEnabled === false) {
      skip(id, "Stories are switched off for this workspace.");
      continue;
    }
    if (story && !supportsPlacement(platform, "stories")) {
      skip(id, `${label(platform)} has no Stories. Stories go to Instagram and Facebook.`);
      continue;
    }
    const existingPostId: string | undefined = item.meta?.postforme_post_id;

    // A scheduled item that already has a provider post: publish it now, or
    // move its time — never create a second post.
    if (item.status === "scheduled" && existingPostId) {
      if (!(await ownsProviderPost(deps.db, args.workspaceId, item.id, existingPostId))) {
        skip(id, FOREIGN_POST);
        continue;
      }
      const outcome =
        kind === "publish"
          ? await publishExistingPost(args.workspaceId, args.userId, item, existingPostId, deps)
          : await rescheduleExistingPost(item, existingPostId, utc as string, deps);
      if ("body" in outcome) return outcome;
      results.push(outcome);
      continue;
    }

    const targets = resolveTargetAccounts(
      accounts.filter((a) => a.platform === platform),
      args.selection,
    );
    if (targets.length === 0) {
      skip(id, `No connected ${label(platform)} account for this selection`);
      continue;
    }

    const platformData: Record<string, unknown> = {};
    if (platform === "tiktok") {
      const privacy = args.tiktokPrivacyLevel || item.meta?.tiktok_privacy_level;
      if (!privacy) {
        skip(id, "TikTok requires choosing who can see this post before it can be sent.");
        continue;
      }
      platformData.tiktok = { privacy_level: String(privacy) };
    }

    if (hasForeignStoragePath(item)) {
      skip(id, "The attached media doesn't belong to this workspace.");
      continue;
    }

    const text = String(item.body ?? "");
    const title = platform === "youtube" ? youtubeTitle(item) : undefined;
    // A carousel sends all its slides and a Story all its frames; the hook
    // redraws them first if their words changed.
    const designedPaths = deps.designedMedia
      ? await deps.designedMedia(item).catch((e) => {
          console.error("[postforme] designed media unavailable", id, e);
          return null;
        })
      : null;
    if (story && item.meta?.story?.mode === "frames" && deps.designedMedia && !designedPaths) {
      skip(id, "The Story frames could not be updated. Try again before publishing.");
      continue;
    }
    const storagePaths =
      designedPaths &&
      designedPaths.length >= (story ? 1 : 2) &&
      designedPaths.length <= 20 &&
      designedPaths.every((p) => isWorkspaceStoragePath(p, item.workspace_id))
        ? designedPaths
        : storagePathsOf(item);
    const externalUrl = publicMediaUrl(item);
    let validationMedia: MediaSource[] = [];
    if (storagePaths.length) {
      const urls = await Promise.all(storagePaths.map((p) => signedUrl(deps.db, p)));
      if (urls.some((url) => !url)) {
        skip(id, "The attached media couldn't be read from storage.");
        continue;
      }
      validationMedia = urls.map((url) => ({ source_type: "url", source: url as string }));
    } else if (externalUrl) {
      validationMedia = [{ source_type: "url", source: externalUrl }];
    }
    if (story && !validationMedia.length) {
      skip(id, "This Story has no frames to send yet. Open it in Studio to finish it.");
      continue;
    }
    const decorate = (list: MediaSource[]): MediaSource[] => {
      const mentions =
        story && platform === "instagram" ? cleanMentions(item.meta?.story?.mentions) : [];
      const thumbMs = Number(item.meta?.thumbnail_ms);
      return list.map((m) => ({
        ...m,
        ...(mentions.length
          ? {
              tags: mentions.map((u) => ({
                id: u,
                platform: "instagram" as const,
                type: "user" as const,
              })),
            }
          : {}),
        ...(!story && Number.isFinite(thumbMs) && thumbMs >= 0 && item.meta?.media_type === "video"
          ? { thumbnail_timestamp_ms: Math.round(thumbMs) }
          : {}),
      }));
    };
    validationMedia = decorate(validationMedia);
    const frameCount = story ? validationMedia.length : null;
    const baseBody = {
      text,
      ...(title ? { title } : {}),
      ...(Object.keys(platformData).length ? { platform_data: platformData } : {}),
      ...(placement ? { placements: { [platform]: toProviderPlacement(placement) } } : {}),
    };

    // 1. Provider-side validation (free, authoritative per-platform rules).
    const validation = await deps.api<{
      valid?: boolean;
      errors?: Array<{ message?: string; platform?: string }>;
    }>({
      method: "POST",
      path: "/posts/validate",
      body: {
        ...baseBody,
        media: validationMedia,
        account_ids: targets.map((t) => t.accountId),
        ...(utc ? { scheduled_at: utc } : {}),
      },
      retry: true,
    });
    if (validation.status !== 200) return socialApiErrorResponse(validation);
    if (validation.data?.valid === false) {
      const reasons = (validation.data.errors ?? [])
        .map((e) => (e.platform ? `${label(e.platform)}: ${e.message}` : e.message))
        .filter(Boolean);
      skip(id, reasons.join(" ") || `This post doesn't meet ${label(platform)}'s requirements.`);
      continue;
    }

    // 2. Daily fair-use guard. Plans include unlimited posts.
    if (deps.quota) {
      const q = await deps.quota.check(args.workspaceId, targets.length * (frameCount ?? 1));
      if (!q.ok) {
        return {
          status: 429,
          body: {
            error: {
              code: "QUOTA_EXCEEDED",
              detail: `This brand has reached the fair-use guard of ${q.limit} posts today. Try again tomorrow.`,
            },
            results,
          },
        };
      }
    }

    // 3. Claim the item so a concurrent click can't create a second post.
    const notReady = await promoteForDistribution(
      deps.db,
      item,
      kind === "publish" ? "publishing" : "scheduled",
    );
    if (notReady) {
      skip(id, notReady);
      continue;
    }
    const priorStatus = item.status as string;
    const priorScheduledAt = item.scheduled_at ?? null;
    const claimedAt = nowMs(deps);
    const claimed = await claimItem(
      deps.db,
      item,
      kind === "publish" ? "publishing" : "scheduled",
      kind === "schedule" ? { scheduled_at: utc } : {},
    );
    if (!claimed) {
      skip(id, CLAIM_LOST);
      continue;
    }
    const claimedStatus = kind === "publish" ? "publishing" : "scheduled";
    const release = async (reason: string) => {
      await moveItemStatus(
        deps.db,
        id,
        claimedStatus,
        kind === "publish" ? "failed" : priorStatus,
        {
          meta: mergeMeta(item.meta, { last_distribution_error: reason.slice(0, 500) }),
          ...(kind === "schedule" ? { scheduled_at: priorScheduledAt } : {}),
        },
      );
    };

    // 4. Media for the real post. Scheduled posts copy stored assets into the
    //    provider library (a signed URL would expire before the schedule fires).
    let media: MediaSource[] = validationMedia;
    if (kind === "schedule" && storagePaths.length) {
      const uploadedIds: string[] = [];
      let uploadError: string | null = null;
      for (const path of storagePaths) {
        const uploaded = await uploadStoredAsset(deps, path);
        if (!uploaded.ok) {
          uploadError = uploaded.reason;
          break;
        }
        uploadedIds.push(uploaded.mediaId);
      }
      if (uploadError) {
        await release(uploadError);
        skip(id, uploadError);
        continue;
      }
      media = decorate(
        uploadedIds.map((mediaId) => ({ source_type: "media_id", source: mediaId })),
      );
    }

    // 5. Create. Never auto-retried: POST /posts has no idempotency key.
    const externalId = `${args.workspaceId}:${id}:${claimedAt}`;
    const body = {
      ...baseBody,
      external_id: externalId,
      ...(media.length ? { media } : {}),
      targets: targets.map((t) => ({ account_id: t.accountId })),
      ...(kind === "publish" ? { publish_now: true } : { scheduled_at: utc }),
    };
    let post: ProviderPost | null = null;
    try {
      const res = await deps.api<ProviderPost & { error?: { code?: string; message?: string } }>({
        method: "POST",
        path: "/posts",
        body,
        timeoutMs: 60_000,
      });
      if ((res.status === 201 || res.status === 207 || res.status === 422) && res.data?.id) {
        post = res.data;
      } else {
        const mapped = socialApiErrorResponse(res);
        await release(mapped.body.error.detail);
        // Item-level platform problems don't stop the batch; systemic ones do.
        if (mapped.body.error.code === "PLATFORM_VALIDATION") {
          skip(id, mapped.body.error.detail);
          continue;
        }
        return { ...mapped, body: { ...mapped.body, results } };
      }
    } catch (e) {
      post = await findAcceptedPost(
        deps,
        targets.map((t) => t.accountId),
        externalId,
      );
      if (!post) {
        const mapped = distributionErrorResponse(e);
        await release(mapped.body.error.detail);
        return { ...mapped, body: { ...mapped.body, results } };
      }
    }

    // 6. Record deliveries, credit usage and the item's resulting status.
    const now = iso(nowMs(deps));
    const providerTargets: ProviderTarget[] = post.targets?.length
      ? post.targets
      : targets.map((t) => ({ account_id: t.accountId, status: "pending" }));
    const rows = deliveryRows({
      workspaceId: args.workspaceId,
      contentItemId: id,
      platform,
      placement,
      frameCount,
      frameSources: story ? (storagePaths.length ? storagePaths : [externalUrl ?? ""]) : undefined,
      post,
      targets: providerTargets,
      now,
    });
    const { error: upsertError } = await deps.db
      .from("content_publications")
      .upsert(rows, { onConflict: "content_item_id,sdr_target_id" });
    if (upsertError)
      console.error("[postforme] delivery rows not recorded", id, upsertError.message);

    await deps.quota
      ?.record({
        workspaceId: args.workspaceId,
        operation: kind,
        providerPostId: post.id,
        contentItemId: id,
        userId: args.userId,
        // Each Story frame is its own post at the provider.
        targets: rows.length * (frameCount ?? 1),
      })
      .catch((e) => console.error("[postforme] usage not recorded", e));

    const meta = mergeMeta(item.meta, {
      postforme_post_id: post.id,
      distribution_provider: "postforme",
      last_distribution_error: null,
    });
    if (kind === "schedule") {
      await moveItemStatus(deps.db, id, "scheduled", "scheduled", {
        meta,
        scheduled_at: post.scheduled_at ?? utc,
      });
    } else {
      await moveItemStatus(deps.db, id, "publishing", aggregateItemStatus(rows), { meta });
    }

    const failedAll = rows.every((r) => r.status === "failed");
    results.push({
      contentItemId: id,
      status: failedAll ? "failed" : "publishing",
      sdrJobId: post.id,
      providerPostId: post.id,
      targets: rows.length,
      ...(utc ? { scheduledAt: post.scheduled_at ?? utc } : {}),
      ...(failedAll
        ? {
            reason:
              rows.find((r) => r.last_error)?.last_error ?? "Every destination rejected the post.",
          }
        : {}),
    });
  }

  return { status: 200, body: { results } };
}

async function publishExistingPost(
  workspaceId: string,
  userId: string | null,
  item: any,
  postId: string,
  deps: SocialApiDeps,
): Promise<SocialPublishOutcome | HandlerResult> {
  if (deps.quota) {
    const q = await deps.quota.check(workspaceId, 1);
    if (!q.ok) {
      return fail(
        429,
        "QUOTA_EXCEEDED",
        `This brand has reached the fair-use guard of ${q.limit} posts today. Try again tomorrow.`,
      );
    }
  }
  if (!(await claimItem(deps.db, item, "publishing"))) {
    return { contentItemId: item.id, status: "skipped", reason: CLAIM_LOST };
  }
  const res = await deps.api<ProviderPost>({
    method: "POST",
    path: `/posts/${encodeURIComponent(postId)}/publish`,
    timeoutMs: 60_000,
  });
  if (!((res.status === 201 || res.status === 207 || res.status === 422) && res.data?.id)) {
    // Not sent: it is still scheduled at the provider.
    await moveItemStatus(deps.db, item.id, "publishing", "failed");
    await moveItemStatus(deps.db, item.id, "failed", "scheduled");
    return socialApiErrorResponse(res);
  }
  await deps.quota
    ?.record({
      workspaceId,
      operation: "publish",
      providerPostId: postId,
      contentItemId: item.id,
      userId,
      targets: res.data.targets?.length ?? 0,
    })
    .catch(() => undefined);
  await applyPostSnapshot(deps.db, res.data, { now: iso(nowMs(deps)), workspaceId });
  await recomputeSocialItemStatus(deps.db, item.id);
  return { contentItemId: item.id, status: "publishing", sdrJobId: postId, providerPostId: postId };
}

async function rescheduleExistingPost(
  item: any,
  postId: string,
  utc: string,
  deps: SocialApiDeps,
): Promise<SocialPublishOutcome | HandlerResult> {
  const res = await deps.api<ProviderPost>({
    method: "PATCH",
    path: `/posts/${encodeURIComponent(postId)}`,
    body: { scheduled_at: utc },
  });
  if (res.status !== 200) return socialApiErrorResponse(res);
  await moveItemStatus(deps.db, item.id, "scheduled", "scheduled", { scheduled_at: utc });
  return {
    contentItemId: item.id,
    status: "already",
    sdrJobId: postId,
    providerPostId: postId,
    scheduledAt: utc,
  };
}

export function publishHandler(
  args: {
    workspaceId: string;
    userId: string | null;
    contentItemIds: string[];
    selection: PublishSelection;
    tiktokPrivacyLevel?: string | null;
  },
  deps: SocialApiDeps,
): Promise<HandlerResult> {
  return distribute(
    "publish",
    { ...args, entries: args.contentItemIds.map((contentItemId) => ({ contentItemId })) },
    deps,
  ).catch(distributionErrorResponse);
}

export function scheduleHandler(
  args: {
    workspaceId: string;
    userId: string | null;
    items: ScheduleItem[];
    selection: PublishSelection;
    tiktokPrivacyLevel?: string | null;
  },
  deps: SocialApiDeps,
): Promise<HandlerResult> {
  return distribute("schedule", { ...args, entries: args.items }, deps).catch(
    distributionErrorResponse,
  );
}

// ─── Cancel a scheduled post ────────────────────────────────────────────────
export async function cancelHandler(
  args: { workspaceId: string; contentItemId: string },
  deps: SocialApiDeps,
): Promise<HandlerResult> {
  try {
    const { data: item } = await deps.db
      .from("content_items")
      .select("*")
      .eq("id", args.contentItemId)
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    if (!item) return fail(404, "NOT_FOUND", "Content item not found");
    const postId = item.meta?.postforme_post_id as string | undefined;
    if (!postId) return fail(400, "PLATFORM_VALIDATION", "Item has no scheduled post to cancel");
    // DELETE on a published post would remove it from the platforms.
    if (item.status !== "scheduled") {
      return fail(400, "PLATFORM_VALIDATION", "Only scheduled posts can be cancelled");
    }
    if (!(await ownsProviderPost(deps.db, args.workspaceId, args.contentItemId, postId))) {
      return fail(403, "PLATFORM_VALIDATION", FOREIGN_POST);
    }
    const res = await deps.api({
      method: "DELETE",
      path: `/posts/${encodeURIComponent(postId)}`,
      retry: true,
    });
    if (res.status === 409 || res.status === 400) {
      return fail(400, "PLATFORM_VALIDATION", "Schedule already fired; cannot cancel");
    }
    if (res.status !== 200 && res.status !== 204 && res.status !== 404) {
      return socialApiErrorResponse(res);
    }
    const now = iso(nowMs(deps));
    const { error: pubError } = await deps.db
      .from("content_publications")
      .update({ status: "cancelled", updated_at: now })
      .eq("content_item_id", args.contentItemId)
      .eq("provider", "postforme")
      .eq("sdr_post_id", postId);
    if (pubError) return fail(500, "UNKNOWN", pubError.message);
    await moveItemStatus(deps.db, args.contentItemId, "scheduled", "approved", {
      meta: mergeMeta(item.meta, { postforme_post_id: null }),
    });
    return { status: 204, body: null };
  } catch (e) {
    return distributionErrorResponse(e);
  }
}

// ─── Retry a failed / partially failed post ─────────────────────────────────
export async function retryHandler(
  args: { workspaceId: string; userId: string | null; contentItemId: string },
  deps: SocialApiDeps,
): Promise<HandlerResult> {
  try {
    const { data: item } = await deps.db
      .from("content_items")
      .select("*")
      .eq("id", args.contentItemId)
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    if (!item) return fail(404, "NOT_FOUND", "Content item not found");
    const postId = item.meta?.postforme_post_id as string | undefined;
    if (!postId) return fail(400, "PLATFORM_VALIDATION", "This item has no post to retry");
    if (item.status !== "failed" && item.status !== "partial_failed") {
      return fail(400, "PLATFORM_VALIDATION", "Only failed deliveries can be retried");
    }
    if (!(await ownsProviderPost(deps.db, args.workspaceId, args.contentItemId, postId))) {
      return fail(403, "PLATFORM_VALIDATION", FOREIGN_POST);
    }
    const { data: failed } = await deps.db
      .from("content_publications")
      .select("id, sdr_target_id, frames, placement")
      .eq("workspace_id", args.workspaceId)
      .eq("content_item_id", args.contentItemId)
      .eq("provider", "postforme")
      .eq("status", "failed");
    const failedRows = (failed ?? []) as Array<{
      id: string;
      sdr_target_id: string;
      frames: unknown;
      placement: string | null;
    }>;
    const targetIds = failedRows.map((r) => r.sdr_target_id);
    if (!targetIds.length)
      return fail(409, "CONFLICT", "There are no failed destinations to retry");
    const fetched = await fetchBrandAccounts(deps);
    if (!fetched.ok) return fetched.res;
    if (
      targetIds.some(
        (id) => !fetched.accounts.some((a) => a.accountId === id && a.status === "active"),
      )
    ) {
      return fail(400, "ACCOUNT_EXPIRED", "Reconnect the failed destination before retrying");
    }
    const designed = deps.designedMedia ? await deps.designedMedia(item).catch(() => null) : null;
    if (
      isStoryItem(item) &&
      item.meta?.story?.mode === "frames" &&
      deps.designedMedia &&
      !designed
    ) {
      return fail(
        409,
        "CONFLICT",
        "The Story frames could not be updated. Try again before retrying.",
      );
    }
    const storagePaths =
      designed?.length && designed.every((p) => isWorkspaceStoragePath(p, item.workspace_id))
        ? designed
        : storagePathsOf(item);
    const urls = storagePaths.length
      ? await Promise.all(storagePaths.map((p) => signedUrl(deps.db, p)))
      : [publicMediaUrl(item)];
    if (storagePaths.length && urls.some((u) => !u))
      return fail(400, "PLATFORM_VALIDATION", "The attached media could not be read");
    const mediaUrls = urls.filter((u): u is string => !!u);
    const platform = String(item.meta?.platform ?? "");
    const placement = placementForItem(item);
    const story = isStoryItem(item);
    const mentions =
      story && platform === "instagram" ? cleanMentions(item.meta?.story?.mentions) : [];
    const source = (url: string): MediaSource => ({
      source_type: "url",
      source: url,
      ...(mentions.length
        ? {
            tags: mentions.map((u) => ({
              id: u,
              platform: "instagram" as const,
              type: "user" as const,
            })),
          }
        : {}),
    });

    // A Story resends only the frames that failed, per account. Frames that
    // already went out are never posted again.
    const plan = failedRows.map((row) => {
      const frames = story ? readFrames(row.frames) : null;
      return { row, frames, retry: frames ? framesToRetry(frames) : null };
    });
    if (story) {
      if (plan.some((p) => !p.frames || p.frames.length !== mediaUrls.length)) {
        return fail(
          409,
          "CONFLICT",
          "This Story changed after it was sent, so its missing frames can't be matched. Send it again as a new Story.",
        );
      }
      const sources = storagePaths.length ? storagePaths : [publicMediaUrl(item)];
      if (plan.some((p) => p.frames?.some((f) => !f.source || f.source !== sources[f.i]))) {
        return fail(
          409,
          "CONFLICT",
          "This Story's media changed after it was sent. Create a new Story to publish the new version.",
        );
      }
      if (plan.every((p) => !p.retry?.length))
        return fail(
          409,
          "CONFLICT",
          "The provider did not identify which frames went out. Check the account and create a new Story if needed.",
        );
    }
    const accountMedia = story
      ? plan
          .filter((p) => p.retry?.length)
          .map((p) => ({
            account_id: p.row.sdr_target_id,
            media: p.retry!.map((i) => source(mediaUrls[i])),
          }))
      : [];
    const sameFrames =
      accountMedia.length > 0 &&
      accountMedia.every((a) => JSON.stringify(a.media) === JSON.stringify(accountMedia[0].media));
    const retryTargets = story ? accountMedia.map((a) => a.account_id) : targetIds;
    if (deps.quota) {
      const needed = story
        ? accountMedia.reduce((total, account) => total + account.media.length, 0)
        : retryTargets.length;
      const q = await deps.quota.check(args.workspaceId, needed);
      if (!q.ok) {
        return fail(
          429,
          "QUOTA_EXCEEDED",
          `This brand has reached the fair-use guard of ${q.limit} posts today. Try again tomorrow.`,
        );
      }
    }
    const retryItem = { ...item };
    const notReady = await promoteForDistribution(deps.db, retryItem, "publishing");
    if (notReady) return fail(409, "CONFLICT", notReady);
    if (!(await claimItem(deps.db, retryItem, "publishing"))) {
      return fail(409, "CONFLICT", CLAIM_LOST);
    }
    const externalId = `${args.workspaceId}:${item.id}:retry:${nowMs(deps)}`;
    const body = {
      text: String(item.body ?? ""),
      external_id: externalId,
      ...(story
        ? {
            media: accountMedia[0].media,
            ...(sameFrames ? {} : { account_media: accountMedia }),
          }
        : mediaUrls.length
          ? { media: mediaUrls.map((url) => source(url)) }
          : {}),
      ...(placement ? { placements: { [platform]: toProviderPlacement(placement) } } : {}),
      targets: retryTargets.map((accountId) => ({ account_id: accountId })),
      publish_now: true,
    };
    let retryPost: ProviderPost | null = null;
    try {
      const res = await deps.api<ProviderPost>({
        method: "POST",
        path: "/posts",
        body,
        timeoutMs: 60_000,
      });
      if (res.status === 201 && res.data?.id) retryPost = res.data;
      else {
        await moveItemStatus(deps.db, item.id, "publishing", "failed");
        await recomputeSocialItemStatus(deps.db, item.id);
        return socialApiErrorResponse(res);
      }
    } catch (error) {
      retryPost = await findAcceptedPost(deps, retryTargets, externalId);
      if (!retryPost) {
        await moveItemStatus(deps.db, item.id, "publishing", "failed");
        await recomputeSocialItemStatus(deps.db, item.id);
        return distributionErrorResponse(error);
      }
    }

    const now = iso(nowMs(deps));
    const newPostId = retryPost.id;
    for (const p of plan) {
      if (story && !p.retry?.length) continue;
      const frames = p.frames && p.retry ? markRetried(p.frames, p.retry, newPostId) : null;
      await deps.db
        .from("content_publications")
        .update({
          sdr_post_id: newPostId,
          status: "publishing",
          error_category: null,
          error_code: null,
          last_error: null,
          updated_at: now,
          ...(frames ? { frames } : {}),
        })
        .eq("id", p.row.id)
        .eq("status", "failed");
    }
    await deps.quota
      ?.record({
        workspaceId: args.workspaceId,
        operation: "retry",
        providerPostId: newPostId,
        contentItemId: args.contentItemId,
        userId: args.userId,
        targets: story ? accountMedia.reduce((n, a) => n + a.media.length, 0) : targetIds.length,
      })
      .catch(() => undefined);
    await moveItemStatus(deps.db, args.contentItemId, "publishing", "publishing", {
      meta: mergeMeta(item.meta, { postforme_post_id: newPostId }),
    });
    return { status: 200, body: { contentItemId: args.contentItemId, status: "publishing" } };
  } catch (e) {
    return distributionErrorResponse(e);
  }
}

// ─── Sync one post from the provider (reconcile + recovery) ─────────────────
export async function syncPostHandler(
  args: { workspaceId?: string; postId: string },
  deps: Pick<SocialApiDeps, "api" | "db" | "now">,
): Promise<{ touched: string[]; status: string | null }> {
  const res = await deps.api<ProviderPost>({
    path: `/posts/${encodeURIComponent(args.postId)}`,
    retry: true,
  });
  const now = iso(nowMs(deps));
  let post: ProviderPost | null = null;
  if (res.status === 200 && res.data?.id) post = res.data;
  // Deleted upstream (e.g. from the provider dashboard): in-flight rows are cancelled.
  else if (res.status === 404) post = { id: args.postId, status: "cancelled", targets: [] };
  if (!post) return { touched: [], status: null };
  const touched = await applyPostSnapshot(deps.db, post, { now, workspaceId: args.workspaceId });
  for (const itemId of touched) await recomputeSocialItemStatus(deps.db, itemId);
  return { touched, status: post.status ?? null };
}

// ─── Engagement metrics ─────────────────────────────────────────────────────
export type EngagementTotals = {
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  /** Unique people reached, where the network reports it (Stories, Instagram, Facebook). */
  reach: number;
  /** Story replies (they arrive as direct messages). */
  replies: number;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function targetEngagement(m: ProviderTarget["metrics"]): EngagementTotals {
  const extra = (m?.extra ?? {}) as Record<string, unknown>;
  return {
    likes: num(m?.likes),
    comments: num(m?.comments),
    shares: num(m?.shares),
    saves: num(m?.saves),
    views: Math.max(
      num(extra.views),
      num(extra.video_views),
      num(extra.impressions),
      num(extra.plays),
    ),
    reach: num(extra.reach),
    replies: num(extra.replies),
  };
}

/** A Story row's numbers, frame by frame, matched by the network's own post ids. */
export function storyRowMetrics(
  frames: FrameResult[],
  entries: NonNullable<ProviderTarget["frames"]>,
): { total: StoryMetrics; perFrame: StoryMetrics[]; hold: number | null } | null {
  const byId = new Map(
    entries
      .filter((e) => typeof e.platform_post_id === "string" && e.platform_post_id)
      .map((e) => [e.platform_post_id as string, storyMetricsFrom(e.metrics)]),
  );
  const perFrame = frames.map((f) => (f.platformPostId ? byId.get(f.platformPostId) : undefined));
  const known = perFrame.filter((m): m is StoryMetrics => !!m);
  // Frames without a recorded id still count toward the totals, never twice.
  const matched = new Set(frames.map((f) => f.platformPostId).filter(Boolean));
  const unmatched = [...byId.entries()].filter(([id]) => !matched.has(id)).map(([, m]) => m);
  const all = [...known, ...unmatched];
  if (!all.length) return null;
  const ordered = perFrame.every(Boolean) ? (perFrame as StoryMetrics[]) : all;
  return { total: combineFrames(all), perFrame: ordered, hold: holdRate(ordered) };
}

/** Pull live metrics for one post into its rows and roll them up on the item. */
export async function syncPostMetrics(
  args: { postId: string; workspaceId?: string },
  deps: Pick<SocialApiDeps, "api" | "db" | "now">,
): Promise<{ updated: number }> {
  const cache = new Map<string, ProviderTarget[] | null>();
  const targetsOf = async (postId: string): Promise<ProviderTarget[] | null> => {
    if (cache.has(postId)) return cache.get(postId) ?? null;
    const res = await deps.api<{ data?: { targets?: ProviderTarget[] } }>({
      path: `/posts/${encodeURIComponent(postId)}/metrics`,
      retry: true,
    });
    const targets = res.status === 200 ? (res.data?.data?.targets ?? []) : null;
    cache.set(postId, targets);
    return targets;
  };
  if (!(await targetsOf(args.postId))) return { updated: 0 };
  const now = iso(nowMs(deps));
  let query = deps.db
    .from("content_publications")
    .select("id, content_item_id, sdr_target_id, metrics, frames")
    .eq("provider", "postforme")
    .eq("sdr_post_id", args.postId);
  if (args.workspaceId) query = query.eq("workspace_id", args.workspaceId);
  const { data: rows } = await query;
  let updated = 0;
  const items = new Set<string>();
  for (const row of (rows ?? []) as any[]) {
    const frames = readFrames(row.frames);
    let metrics: Record<string, unknown> | null = null;
    if (frames) {
      // A retried Story has frames in more than one provider post.
      const entries: NonNullable<ProviderTarget["frames"]> = [];
      for (const postId of framePostIds(frames, args.postId)) {
        const t = (await targetsOf(postId))?.find((x) => x.account_id === row.sdr_target_id);
        entries.push(...(t?.frames ?? []));
      }
      const story = storyRowMetrics(frames, entries);
      // Once a Story has expired a network may answer with zeros: the last
      // live snapshot stays.
      const hadNumbers = num(row.metrics?.reach) > 0 || num(row.metrics?.views) > 0;
      if (story && (story.total.reach > 0 || story.total.views > 0 || !hadNumbers)) {
        metrics = {
          likes: 0,
          comments: 0,
          shares: story.total.shares,
          saves: 0,
          views: story.total.views,
          reach: story.total.reach,
          replies: story.total.replies,
          taps: story.total.taps,
          profile_visits: story.total.profileVisits,
          follows: story.total.follows,
          hold: story.hold,
          frames: story.perFrame,
          story: true,
        };
      }
    } else {
      const t = (await targetsOf(args.postId))?.find((x) => x.account_id === row.sdr_target_id);
      if (t?.metrics) metrics = { ...targetEngagement(t.metrics), raw: t.metrics };
    }
    if (!metrics) continue;
    const { error } = await deps.db
      .from("content_publications")
      .update({ metrics, metrics_synced_at: now })
      .eq("id", row.id);
    if (!error) {
      updated++;
      items.add(row.content_item_id);
    }
  }
  for (const itemId of items) {
    const { data: all } = await deps.db
      .from("content_publications")
      .select("metrics")
      .eq("content_item_id", itemId)
      .eq("provider", "postforme");
    const totals = ((all ?? []) as Array<{ metrics: any }>).reduce<EngagementTotals>(
      (acc, r) => {
        const m = r.metrics ?? {};
        return {
          likes: acc.likes + num(m.likes),
          comments: acc.comments + num(m.comments),
          shares: acc.shares + num(m.shares),
          saves: acc.saves + num(m.saves),
          views: acc.views + num(m.views),
          reach: acc.reach + num(m.reach),
          replies: acc.replies + num(m.replies),
        };
      },
      { likes: 0, comments: 0, shares: 0, saves: 0, views: 0, reach: 0, replies: 0 },
    );
    // `metrics` is not an approval-invalidating field in the lifecycle trigger.
    await deps.db
      .from("content_items")
      .update({ metrics: { ...totals, source: "postforme", synced_at: now } })
      .eq("id", itemId);
  }
  return { updated };
}
