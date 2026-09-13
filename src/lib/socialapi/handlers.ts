// handlers.ts — SocialAPI.ai distribution handlers. Pure and dependency-injected
// (provider client, Supabase-like db, the workspace's brand id, plan quota) so
// the contract tests run with no network or database. The /api routes are thin
// wrappers; they resolve the workspace's brand server-side and pass it in.
//
// Tenant isolation: every account operation is checked against
// GET /accounts?brand_id=<this workspace's brand>. An account id from the
// browser is never trusted until the provider lists it under that brand.
//
// Delivery bookkeeping reuses the SDR pipeline tables: one content_publications
// row per (content item × target account), sdr_post_id = SocialAPI post id,
// sdr_target_id = account id, provider = 'socialapi'.
import { createHash, randomBytes } from "node:crypto";
import {
  socialApiErrorResponse,
  socialApiTransportError,
  type DistributionErrorCode,
  type SocialApiCall,
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

// ─── Shared shapes ──────────────────────────────────────────────────────────
export type HandlerResult<T = any> = { status: number; body: T };

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
  /** The workspace's SocialAPI brand, resolved server-side. */
  brandId: string;
  quota?: PostQuota;
  now?: () => number;
  fetchFn?: typeof fetch;
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
    provider: "socialapi",
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
        provider: "socialapi",
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
      if (error) console.error("[socialapi] account mirror upsert failed", error.message);
    }
    // The provider hard-deletes disconnected accounts, so absence = disconnected.
    let stale = deps.db
      .from("social_accounts")
      .update({ status: "disconnected", disconnected_at: now, updated_at: now })
      .eq("workspace_id", workspaceId)
      .eq("provider", "socialapi")
      .neq("status", "disconnected");
    if (accounts.length) {
      const list = accounts.map((a) => `"${a.accountId.replace(/["\\]/g, "")}"`).join(",");
      stale = stale.not("provider_account_id", "in", `(${list})`);
    }
    const { error } = await stale;
    if (error) console.error("[socialapi] account mirror prune failed", error.message);
  } catch (e) {
    console.error("[socialapi] account mirror sync failed", e instanceof Error ? e.message : e);
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
// POST /accounts/connect returns an auth_url; the platform redirects to
// SocialAPI, which 302s the user to OUR redirect_uri with status/account_id/
// state. `state` is our CSRF + tenant binding: a random value whose SHA-256 is
// stored with the workspace and user that started the flow.
export const CONNECT_TTL_MS = 30 * 60 * 1000;

export const hashState = (state: string) => createHash("sha256").update(state).digest("hex");

export async function startConnectHandler(
  args: { workspaceId: string; userId: string; platform: string; redirectUri: string },
  deps: SocialApiDeps,
): Promise<HandlerResult> {
  if (!(PROVIDER_PLATFORMS.socialapi as string[]).includes(args.platform)) {
    return fail(400, "PLATFORM_VALIDATION", `Unsupported platform: ${args.platform}`);
  }
  const state = randomBytes(32).toString("base64url");
  const stateHash = hashState(state);
  const now = nowMs(deps);
  try {
    // Opportunistic cleanup of long-expired states.
    await deps.db
      .from("social_oauth_states")
      .delete()
      .lt("expires_at", iso(now - 24 * 3600 * 1000));
    const { error } = await deps.db.from("social_oauth_states").insert({
      state_hash: stateHash,
      workspace_id: args.workspaceId,
      user_id: args.userId,
      provider: "socialapi",
      platform: args.platform,
      expires_at: iso(now + CONNECT_TTL_MS),
    });
    if (error) {
      console.error("[socialapi] connect state not stored", error.message);
      return fail(500, "UNKNOWN", "Couldn't start the connection. Please try again.");
    }

    const res = await deps.api<{ auth_url?: string; account_id?: string }>({
      method: "POST",
      path: "/accounts/connect",
      body: {
        platform: args.platform,
        redirect_uri: args.redirectUri,
        state,
        brand_id: deps.brandId,
      },
    });
    if (res.status === 202 && typeof res.data?.auth_url === "string") {
      let url: URL | null = null;
      try {
        url = new URL(res.data.auth_url);
      } catch {
        url = null;
      }
      if (!url || url.protocol !== "https:") {
        await deps.db.from("social_oauth_states").delete().eq("state_hash", stateHash);
        return fail(
          502,
          "DISTRIBUTION_UNAVAILABLE",
          "The provider returned an invalid authorization link.",
        );
      }
      return {
        status: 200,
        body: { authorizationUrl: url.toString(), expiresIn: CONNECT_TTL_MS / 1000 },
      };
    }
    await deps.db.from("social_oauth_states").delete().eq("state_hash", stateHash);
    if (res.status === 201 && res.data?.account_id) {
      // Credential platforms connect without a redirect.
      const fetched = await fetchBrandAccounts(deps);
      if (fetched.ok) {
        await syncAccountMirror(deps, args.workspaceId, fetched.accounts, {
          connectedBy: args.userId,
          connectedAccountId: res.data.account_id,
        });
      }
      return { status: 200, body: { connected: true, accountId: res.data.account_id } };
    }
    return socialApiErrorResponse(res);
  } catch (e) {
    await deps.db
      .from("social_oauth_states")
      .delete()
      .eq("state_hash", stateHash)
      .then(
        () => undefined,
        () => undefined,
      );
    return distributionErrorResponse(e);
  }
}

export type PendingPage = {
  id: string;
  name: string;
  pictureUrl: string | null;
  category: string | null;
  assignable: boolean;
};
export type PendingProfile = {
  id: string;
  displayName: string;
  username: string | null;
  pictureUrl: string | null;
};

export type ConnectCompletion =
  | { status: "connected"; accountId: string; account: ConnectedAccount | null }
  | {
      status: "selection_required";
      connectionId: string;
      platform: string;
      expiresAt: string | null;
      pages: PendingPage[];
      profiles: PendingProfile[];
      /** Page names this re-authorization revoked (never another brand's name). */
      lostAccess: string[];
    }
  | { status: "error"; message: string };

type StateRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  platform: string;
  connection_id: string | null;
  expires_at: string;
  consumed_at: string | null;
};

const CALLBACK_ERRORS: Record<string, string> = {
  access_denied: "Authorization was cancelled on the platform.",
};

async function loadPending(
  deps: SocialApiDeps,
  connectionId: string,
  platform: string,
): Promise<HandlerResult> {
  const res = await deps.api<any>({
    path: `/accounts/pending/${encodeURIComponent(connectionId)}`,
    retry: true,
  });
  if (res.status === 404) {
    return fail(410, "NOT_FOUND", "This selection expired. Start the connection again.");
  }
  if (res.status !== 200) return socialApiErrorResponse(res);
  const d = res.data ?? {};
  return {
    status: 200,
    body: {
      status: "selection_required",
      connectionId,
      platform: d.platform ?? platform,
      expiresAt: d.expires_at ?? null,
      pages: (Array.isArray(d.pages) ? d.pages : []).map((p: any) => ({
        id: String(p.platform_page_id),
        name: String(p.name ?? "Untitled Page"),
        pictureUrl: p.picture_url || null,
        category: p.category || null,
        assignable: p.assignable !== false,
      })),
      profiles: (Array.isArray(d.profiles) ? d.profiles : []).map((p: any) => ({
        id: String(p.platform_account_id),
        displayName: String(p.display_name ?? ""),
        username: p.username || null,
        pictureUrl: p.profile_picture_url || null,
      })),
      lostAccess: (Array.isArray(d.lost_access) ? d.lost_access : [])
        .map((l: any) => String(l.name ?? ""))
        .filter(Boolean),
    },
  };
}

export async function completeConnectHandler(
  args: {
    workspaceId: string;
    userId: string;
    state: string;
    status: string;
    accountId?: string | null;
    connectionId?: string | null;
    error?: string | null;
    errorDescription?: string | null;
  },
  deps: SocialApiDeps,
): Promise<HandlerResult<ConnectCompletion | any>> {
  if (!args.state)
    return fail(400, "PLATFORM_VALIDATION", "This connection link is missing its state.");
  try {
    const { data: row } = (await deps.db
      .from("social_oauth_states")
      .select("id, workspace_id, user_id, platform, connection_id, expires_at, consumed_at")
      .eq("state_hash", hashState(args.state))
      .maybeSingle()) as { data: StateRow | null };
    if (!row)
      return fail(
        400,
        "PLATFORM_VALIDATION",
        "This connection link is invalid or was already used.",
      );
    // Bound to the user AND workspace that started it: a link opened by anyone
    // else (or in another workspace) cannot attach an account.
    if (row.user_id !== args.userId || row.workspace_id !== args.workspaceId) {
      return fail(
        403,
        "UNAUTHORIZED",
        "This connection was started by a different user or workspace.",
      );
    }
    if (Date.parse(row.expires_at) < nowMs(deps)) {
      return fail(410, "NOT_FOUND", "This connection link expired. Start the connection again.");
    }
    const { data: claimed } = await deps.db
      .from("social_oauth_states")
      .update({
        consumed_at: iso(nowMs(deps)),
        connection_id: args.connectionId ?? null,
      })
      .eq("id", row.id)
      .is("consumed_at", null)
      .select("id");
    if (!Array.isArray(claimed) || claimed.length === 0) {
      return fail(409, "DUPLICATE", "This connection was already completed.");
    }

    if (args.status === "error") {
      const message =
        (args.error && CALLBACK_ERRORS[args.error]) ||
        args.errorDescription ||
        "The platform didn't complete the authorization.";
      return { status: 200, body: { status: "error", message } };
    }

    if (args.status === "selection_required") {
      if (!args.connectionId) {
        return fail(
          400,
          "PLATFORM_VALIDATION",
          "The provider didn't return a selection to finish.",
        );
      }
      return loadPending(deps, args.connectionId, row.platform);
    }

    if (args.status !== "success" || !args.accountId) {
      return fail(400, "PLATFORM_VALIDATION", "Unexpected connection result.");
    }
    const fetched = await fetchBrandAccounts(deps);
    if (!fetched.ok) return fetched.res;
    const account = fetched.accounts.find((a) => a.accountId === args.accountId) ?? null;
    if (!account) {
      return fail(404, "NOT_FOUND", "The connected account isn't available in this workspace.");
    }
    await syncAccountMirror(deps, args.workspaceId, fetched.accounts, {
      connectedBy: args.userId,
      connectedAccountId: account.accountId,
    });
    return { status: 200, body: { status: "connected", accountId: account.accountId, account } };
  } catch (e) {
    return distributionErrorResponse(e);
  }
}

/** Re-read a pending selection (still bound to its user + workspace). */
async function pendingStateFor(
  deps: SocialApiDeps,
  args: { workspaceId: string; userId: string; connectionId: string },
): Promise<StateRow | HandlerResult> {
  const { data: row } = (await deps.db
    .from("social_oauth_states")
    .select("id, workspace_id, user_id, platform, connection_id, expires_at, consumed_at")
    .eq("connection_id", args.connectionId)
    .eq("workspace_id", args.workspaceId)
    .eq("user_id", args.userId)
    .maybeSingle()) as { data: StateRow | null };
  if (!row) return fail(404, "NOT_FOUND", "This selection doesn't belong to you or has expired.");
  if (Date.parse(row.expires_at) < nowMs(deps)) {
    return fail(410, "NOT_FOUND", "This selection expired. Start the connection again.");
  }
  return row;
}

export async function getPendingHandler(
  args: { workspaceId: string; userId: string; connectionId: string },
  deps: SocialApiDeps,
): Promise<HandlerResult> {
  try {
    const row = await pendingStateFor(deps, args);
    if ("status" in row && "body" in row) return row;
    return loadPending(deps, args.connectionId, (row as StateRow).platform);
  } catch (e) {
    return distributionErrorResponse(e);
  }
}

export async function selectPendingHandler(
  args: {
    workspaceId: string;
    userId: string;
    connectionId: string;
    pageIds?: string[];
    platformAccountId?: string | null;
  },
  deps: SocialApiDeps,
): Promise<HandlerResult> {
  const pageIds = (args.pageIds ?? []).filter((p) => typeof p === "string" && p.length > 0);
  if (!pageIds.length && !args.platformAccountId) {
    return fail(400, "PLATFORM_VALIDATION", "Choose at least one Page to connect.");
  }
  try {
    const row = await pendingStateFor(deps, args);
    if ("status" in row && "body" in row) return row;
    const res = await deps.api<{ account_id?: string }>({
      method: "POST",
      path: `/accounts/pending/${encodeURIComponent(args.connectionId)}/select`,
      body: pageIds.length
        ? { page_ids: pageIds }
        : { platform_account_id: args.platformAccountId },
    });
    if (res.status === 404) {
      return fail(
        410,
        "NOT_FOUND",
        "This selection expired or was already used. Start the connection again.",
      );
    }
    if (res.status !== 201 && res.status !== 200) return socialApiErrorResponse(res);
    const fetched = await fetchBrandAccounts(deps);
    if (fetched.ok) {
      await syncAccountMirror(deps, args.workspaceId, fetched.accounts, {
        connectedBy: args.userId,
        connectedAccountId: res.data?.account_id ?? null,
      });
    }
    return {
      status: 200,
      body: { status: "connected", accountId: res.data?.account_id ?? null },
    };
  } catch (e) {
    return distributionErrorResponse(e);
  }
}

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
      if (error) console.error("[socialapi] item update failed", itemId, error.message);
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
    console.warn(`[socialapi] item ${itemId}: no legal path ${from} → ${next}`);
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
      console.error(`[socialapi] item ${itemId}: ${current} → ${status} refused`, error.message);
      return current;
    }
    current = status;
  }
  return current;
}

/** Recompute an item's editorial status from its SocialAPI delivery rows. */
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
    .eq("provider", "socialapi")
    .eq("sdr_post_id", post.id);
  if (opts.workspaceId) query = query.eq("workspace_id", opts.workspaceId);
  const { data: rows } = await query;
  const touched = new Set<string>();
  for (const row of (rows ?? []) as any[]) {
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
      console.error("[socialapi] delivery row update failed", row.id, error.message);
      continue;
    }
    touched.add(row.content_item_id);
  }
  return [...touched];
}

// ─── Media ──────────────────────────────────────────────────────────────────
type MediaSource = { source_type: "url" | "media_id"; source: string };
const SERVER_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const STORAGE_BUCKET = "generated-assets";

function storagePathOf(item: any): string | null {
  const p = item?.meta?.asset_storage_path;
  return typeof p === "string" && p ? p : null;
}

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
    const { error } = await db
      .from("content_items")
      .update({ status })
      .eq("id", item.id)
      .eq("status", item.status);
    if (error) return `Couldn't approve content before distribution: ${error.message}`;
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
    console.error("[socialapi] claim failed", item.id, error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * After a transport failure on POST /posts we cannot know whether the provider
 * accepted it (there is no idempotency key). Look for a post created since the
 * claim with the same text on the same accounts before declaring failure, so a
 * timeout never turns into a duplicate on the next click.
 */
async function findAcceptedPost(
  deps: SocialApiDeps,
  accountIds: string[],
  text: string,
  sinceMs: number,
): Promise<ProviderPost | null> {
  try {
    const res = await deps.api<{ data?: ProviderPost[] }>({
      path: "/posts",
      query: {
        account_ids: accountIds.join(","),
        brand_id: deps.brandId,
        from: iso(sinceMs - 2 * 60 * 1000),
        sort: "created_desc",
        limit: 10,
      },
      retry: true,
    });
    if (res.status !== 200) return null;
    return (res.data?.data ?? []).find((p) => (p.text ?? "") === text) ?? null;
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
    if (!platform || !(PROVIDER_PLATFORMS.socialapi as string[]).includes(platform)) {
      skip(id, `No deliverable platform (${platform ?? "none"})`);
      continue;
    }
    const existingPostId: string | undefined = item.meta?.socialapi_post_id;

    // A scheduled item that already has a provider post: publish it now, or
    // move its time — never create a second post.
    if (item.status === "scheduled" && existingPostId) {
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

    const text = String(item.body ?? "");
    const title = platform === "youtube" ? youtubeTitle(item) : undefined;
    // X publishes text only (the provider ignores media there).
    const storagePath = platform === "twitter" ? null : storagePathOf(item);
    const externalUrl = platform === "twitter" ? null : publicMediaUrl(item);
    let validationMedia: MediaSource[] = [];
    if (storagePath) {
      const url = await signedUrl(deps.db, storagePath);
      if (!url) {
        skip(id, "The attached media couldn't be read from storage.");
        continue;
      }
      validationMedia = [{ source_type: "url", source: url }];
    } else if (externalUrl) {
      validationMedia = [{ source_type: "url", source: externalUrl }];
    }
    const baseBody = {
      text,
      ...(title ? { title } : {}),
      ...(Object.keys(platformData).length ? { platform_data: platformData } : {}),
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

    // 2. Plan quota (each created post uses one post credit).
    if (deps.quota) {
      const q = await deps.quota.check(args.workspaceId, 1);
      if (!q.ok) {
        return {
          status: 429,
          body: {
            error: {
              code: "QUOTA_EXCEEDED",
              detail: `This workspace has used its ${q.limit} publishing credits for this month.`,
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
    if (kind === "schedule" && storagePath) {
      const uploaded = await uploadStoredAsset(deps, storagePath);
      if (!uploaded.ok) {
        await release(uploaded.reason);
        skip(id, uploaded.reason);
        continue;
      }
      media = [{ source_type: "media_id", source: uploaded.mediaId }];
    }

    // 5. Create. Never auto-retried: POST /posts has no idempotency key.
    const body = {
      ...baseBody,
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
        text,
        claimedAt,
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
    const rows = providerTargets.map((t) => ({
      workspace_id: args.workspaceId,
      content_item_id: id,
      provider: "socialapi",
      sdr_post_id: post.id,
      sdr_target_id: t.account_id,
      platform: t.platform ?? platform,
      account_id: t.account_id,
      created_at: now,
      platform_post_id: null,
      platform_post_url: null,
      delivered_at: null,
      error_category: null,
      error_code: null,
      metrics: null,
      metrics_synced_at: null,
      ...rowPatchFor(t, post, targetStatus(t, post), now),
      // Restated with concrete types for the aggregation below.
      status: targetStatus(t, post),
      last_error:
        t.status === "failed" ? (t.error?.message ?? "The platform rejected this post.") : null,
    }));
    const { error: upsertError } = await deps.db
      .from("content_publications")
      .upsert(rows, { onConflict: "content_item_id,sdr_target_id" });
    if (upsertError)
      console.error("[socialapi] delivery rows not recorded", id, upsertError.message);

    await deps.quota
      ?.record({
        workspaceId: args.workspaceId,
        operation: kind,
        providerPostId: post.id,
        contentItemId: id,
        userId: args.userId,
        targets: rows.length,
      })
      .catch((e) => console.error("[socialapi] usage not recorded", e));

    const meta = mergeMeta(item.meta, {
      socialapi_post_id: post.id,
      distribution_provider: "socialapi",
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
        `This workspace has used its ${q.limit} publishing credits for this month.`,
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
    const postId = item.meta?.socialapi_post_id as string | undefined;
    if (!postId) return fail(400, "PLATFORM_VALIDATION", "Item has no scheduled post to cancel");
    // DELETE on a published post would remove it from the platforms.
    if (item.status !== "scheduled") {
      return fail(400, "PLATFORM_VALIDATION", "Only scheduled posts can be cancelled");
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
      .eq("provider", "socialapi")
      .eq("sdr_post_id", postId);
    if (pubError) return fail(500, "UNKNOWN", pubError.message);
    await moveItemStatus(deps.db, args.contentItemId, "scheduled", "approved", {
      meta: mergeMeta(item.meta, { socialapi_post_id: null }),
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
    const postId = item.meta?.socialapi_post_id as string | undefined;
    if (!postId) return fail(400, "PLATFORM_VALIDATION", "This item has no post to retry");
    if (item.status !== "failed" && item.status !== "partial_failed") {
      return fail(400, "PLATFORM_VALIDATION", "Only failed deliveries can be retried");
    }
    if (deps.quota) {
      const q = await deps.quota.check(args.workspaceId, 1);
      if (!q.ok) {
        return fail(
          429,
          "QUOTA_EXCEEDED",
          `This workspace has used its ${q.limit} publishing credits for this month.`,
        );
      }
    }
    const res = await deps.api<{ success?: boolean }>({
      method: "POST",
      path: `/posts/${encodeURIComponent(postId)}/retry`,
    });
    if (res.status === 400 || res.status === 409) {
      // Nothing retryable (e.g. already retried elsewhere): converge on the truth.
      await syncPostHandler({ workspaceId: args.workspaceId, postId }, deps);
      return socialApiErrorResponse(res);
    }
    if (res.status !== 200) return socialApiErrorResponse(res);

    const now = iso(nowMs(deps));
    await deps.db
      .from("content_publications")
      .update({
        status: "publishing",
        error_category: null,
        error_code: null,
        last_error: null,
        updated_at: now,
      })
      .eq("content_item_id", args.contentItemId)
      .eq("provider", "socialapi")
      .eq("sdr_post_id", postId)
      .eq("status", "failed");
    await deps.quota
      ?.record({
        workspaceId: args.workspaceId,
        operation: "retry",
        providerPostId: postId,
        contentItemId: args.contentItemId,
        userId: args.userId,
        targets: 0,
      })
      .catch(() => undefined);
    await moveItemStatus(deps.db, args.contentItemId, item.status, "publishing");
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
  };
}

/** Pull live metrics for one post into its rows and roll them up on the item. */
export async function syncPostMetrics(
  args: { postId: string; workspaceId?: string },
  deps: Pick<SocialApiDeps, "api" | "db" | "now">,
): Promise<{ updated: number }> {
  const res = await deps.api<{ data?: { targets?: ProviderTarget[] } }>({
    path: `/posts/${encodeURIComponent(args.postId)}/metrics`,
    retry: true,
  });
  if (res.status !== 200) return { updated: 0 };
  const now = iso(nowMs(deps));
  let query = deps.db
    .from("content_publications")
    .select("id, content_item_id, sdr_target_id, metrics")
    .eq("provider", "socialapi")
    .eq("sdr_post_id", args.postId);
  if (args.workspaceId) query = query.eq("workspace_id", args.workspaceId);
  const { data: rows } = await query;
  let updated = 0;
  const items = new Set<string>();
  for (const row of (rows ?? []) as any[]) {
    const t = (res.data?.data?.targets ?? []).find((x) => x.account_id === row.sdr_target_id);
    if (!t?.metrics) continue;
    const { error } = await deps.db
      .from("content_publications")
      .update({
        metrics: { ...targetEngagement(t.metrics), raw: t.metrics },
        metrics_synced_at: now,
      })
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
      .eq("provider", "socialapi");
    const totals = ((all ?? []) as Array<{ metrics: any }>).reduce<EngagementTotals>(
      (acc, r) => {
        const m = r.metrics ?? {};
        return {
          likes: acc.likes + num(m.likes),
          comments: acc.comments + num(m.comments),
          shares: acc.shares + num(m.shares),
          saves: acc.saves + num(m.saves),
          views: acc.views + num(m.views),
        };
      },
      { likes: 0, comments: 0, shares: 0, saves: 0, views: 0 },
    );
    // `metrics` is not an approval-invalidating field in the lifecycle trigger.
    await deps.db
      .from("content_items")
      .update({ metrics: { ...totals, source: "socialapi", synced_at: now } })
      .eq("id", itemId);
  }
  return { updated };
}
