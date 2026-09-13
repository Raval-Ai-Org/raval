// sdr.functions.ts — client-side typed surface for social distribution.
//
// /api/sdr/*    provider-neutral distribution routes. The server dispatches to
//               the active provider (SocialAPI.ai, or the self-hosted SDR); the
//               path keeps its historical name so nothing downstream breaks.
// /api/social/* SocialAPI.ai-only capabilities (connect callback, Page
//               selection, retry, TikTok creator settings, metrics, analytics).
//
// Calls go through authedFetch (Supabase Bearer attached); the server checks
// workspace membership and role. No provider credential ever reaches the browser.
import { authedFetch } from "@/lib/authed-fetch";
import type { DistributionPlatformId, DistributionProvider } from "@/lib/distribution-platforms";
import type {
  ConnectedAccount,
  PublishSelection,
  PublishOutcome,
  ScheduleItem,
  ScheduleOutcome,
} from "@/lib/sdr.handlers";
import type { ConnectCompletion } from "@/lib/socialapi/handlers";

export type OauthStartResult = {
  authorizationUrl?: string;
  expiresIn?: number;
  /** Credential-based platforms connect without a redirect. */
  connected?: boolean;
  accountId?: string;
};

export type PublishResult = { results: PublishOutcome[] };
export type ScheduleResult = { results: ScheduleOutcome[] };
export type DistributionOptions = { tiktokPrivacyLevel?: string | null };

/** Plain-language messages per distribution error code. The technical detail
 * stays as a secondary line so a user can still report it. */
const ERROR_MESSAGES: Record<string, string> = {
  DISTRIBUTION_UNAVAILABLE:
    "The publishing service isn't responding. Nothing was lost — try again in a moment.",
  SDR_UNREACHABLE:
    "The publishing service isn't responding. Nothing was lost — try again in a moment.",
  DISTRIBUTION_DISABLED:
    "Direct publishing isn't enabled for this workspace yet. Nothing was sent.",
  PROVIDER_MISCONFIGURED:
    "Social publishing isn't configured correctly. An administrator needs to check it.",
  PROVIDER_BILLING:
    "Publishing is paused until the publishing provider's subscription is resolved by an administrator.",
  ACCOUNT_EXPIRED:
    "This social account's authorization has expired. Reconnect it to publish again.",
  BYOK_REQUIRED:
    "X needs your own X developer app credentials configured with the publishing provider before it can connect.",
  QUOTA_EXCEEDED: "This workspace has used this month's publishing credits.",
  RATE_LIMITED: "The platform is limiting requests right now. Try again in a few minutes.",
  PLATFORM_VALIDATION:
    "This post doesn't meet the platform's requirements. Check the message and try again.",
  DUPLICATE: "This was already submitted — no duplicate was created.",
  CONFLICT: "This post changed on the platform. Refresh to see its latest status.",
  UNSUPPORTED: "This platform doesn't support that action.",
  NOT_FOUND: "The item you're looking for couldn't be found.",
  UNAUTHORIZED: "You don't have permission to do this.",
  UNKNOWN: "Something went wrong while publishing. Please try again.",
};

/** Codes whose detail is already user-facing and specific. */
const VERBATIM = new Set(["PLATFORM_VALIDATION", "QUOTA_EXCEEDED", "NOT_FOUND", "DUPLICATE"]);

export class DistributionRequestError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
    this.name = "DistributionRequestError";
  }
}

function describe(j: { error?: { code?: string; detail?: string } | string }, status: number) {
  // The route kernel's own errors are `{ error: "message" }`.
  if (typeof j?.error === "string") return { code: "UNKNOWN", message: j.error };
  const code = j?.error?.code ?? "";
  const detail = j?.error?.detail ?? "";
  if (VERBATIM.has(code) && detail) return { code, message: detail };
  const friendly = ERROR_MESSAGES[code] ?? `Request failed (${status})`;
  return { code, message: detail && detail !== friendly ? `${friendly} (${detail})` : friendly };
}

async function toError(res: Response): Promise<DistributionRequestError> {
  try {
    const { code, message } = describe(await res.json(), res.status);
    return new DistributionRequestError(message, code, res.status);
  } catch {
    return new DistributionRequestError(`Request failed (${res.status})`, "UNKNOWN", res.status);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await authedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toError(res);
  return (res.status === 204 ? null : await res.json()) as T;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await authedFetch(url);
  if (!res.ok) throw await toError(res);
  return res.json() as Promise<T>;
}

const q = encodeURIComponent;

export type SdrStatus = {
  enabled: boolean;
  canPublish: boolean;
  role: string | null;
  provider: DistributionProvider | null;
  /** Platforms the active provider can publish to. */
  platforms: DistributionPlatformId[];
};

const DISABLED_STATUS: SdrStatus = {
  enabled: false,
  canPublish: false,
  role: null,
  provider: null,
  platforms: [],
};

/** Whether distribution is on for the workspace and the caller may publish. */
export async function getSdrStatus(workspaceId: string): Promise<SdrStatus> {
  const res = await authedFetch(`/api/sdr/status?workspaceId=${q(workspaceId)}`);
  if (!res.ok) return DISABLED_STATUS;
  return { ...DISABLED_STATUS, ...(await res.json()) };
}

/** The workspace's connected accounts. */
export function getConnections(workspaceId: string): Promise<ConnectedAccount[]> {
  return getJson(`/api/sdr/accounts?workspaceId=${q(workspaceId)}`);
}

export async function disconnectAccount(workspaceId: string, accountId: string): Promise<void> {
  await postJson("/api/sdr/disconnect", { workspaceId, accountId });
}

// ─── Connect flow ───────────────────────────────────────────────────────────
// The consent page opens in a popup. The provider redirects it back to
// /app/social/connected, which finishes the flow and tells every open Mellox
// tab over a BroadcastChannel (window.opener is often severed after the popup
// has visited the platform's own origin).
export const SOCIAL_CONNECT_CHANNEL = "mellox-social-connect";
const PENDING_CONNECT_KEY = "social:connect:pending";

export type SocialConnectMessage = { type: "connected" | "error"; platform?: string };

export function broadcastSocialConnect(message: SocialConnectMessage): void {
  try {
    const channel = new BroadcastChannel(SOCIAL_CONNECT_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    /* BroadcastChannel unavailable — the Connections view refreshes on focus */
  }
}

export function subscribeSocialConnect(onMessage: (m: SocialConnectMessage) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(SOCIAL_CONNECT_CHANNEL);
  channel.onmessage = (event) => onMessage(event.data as SocialConnectMessage);
  return () => channel.close();
}

/** The workspace a connect popup was started from (same-origin storage). */
export function readPendingConnect(): { workspaceId: string; platform: string } | null {
  try {
    const raw = localStorage.getItem(PENDING_CONNECT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.workspaceId === "string" ? parsed : null;
  } catch {
    return null;
  }
}

/** Start connect/reconnect; returns the platform consent URL to open. */
export async function oauthStart(workspaceId: string, platform: string): Promise<OauthStartResult> {
  try {
    localStorage.setItem(
      PENDING_CONNECT_KEY,
      JSON.stringify({ workspaceId, platform, startedAt: Date.now() }),
    );
  } catch {
    /* storage blocked: the callback falls back to the active workspace */
  }
  return postJson("/api/sdr/oauth/start", {
    workspaceId,
    platform,
    origin: typeof window !== "undefined" ? window.location.origin : undefined,
  });
}

export function completeSocialConnect(
  workspaceId: string,
  params: {
    state: string;
    status: string;
    accountId?: string | null;
    connectionId?: string | null;
    error?: string | null;
    errorDescription?: string | null;
  },
): Promise<ConnectCompletion> {
  return postJson("/api/social/connect/complete", { workspaceId, ...params });
}

export function getSocialPending(
  workspaceId: string,
  connectionId: string,
): Promise<ConnectCompletion> {
  return getJson(
    `/api/social/connect/select?workspaceId=${q(workspaceId)}&connectionId=${q(connectionId)}`,
  );
}

export function selectSocialPending(
  workspaceId: string,
  connectionId: string,
  pageIds: string[],
): Promise<{ status: "connected"; accountId: string | null }> {
  return postJson("/api/social/connect/select", { workspaceId, connectionId, pageIds });
}

// ─── Publishing ─────────────────────────────────────────────────────────────
export function publishContentItems(
  workspaceId: string,
  contentItemIds: string[],
  selection: PublishSelection,
  options: DistributionOptions = {},
): Promise<PublishResult> {
  return postJson("/api/sdr/publish", { workspaceId, contentItemIds, selection, options });
}

export function scheduleContentItems(
  workspaceId: string,
  items: ScheduleItem[],
  selection: PublishSelection,
  options: DistributionOptions = {},
): Promise<ScheduleResult> {
  return postJson("/api/sdr/schedule", { workspaceId, items, selection, options });
}

/** Cancel a scheduled item before it fires. */
export async function cancelScheduled(workspaceId: string, contentItemId: string): Promise<void> {
  await postJson("/api/sdr/cancel", { workspaceId, contentItemId });
}

/** Retry a failed or partially failed delivery (uses one publishing credit). */
export function retryPublication(
  workspaceId: string,
  contentItemId: string,
): Promise<{ contentItemId: string; status: string }> {
  return postJson("/api/social/retry", { workspaceId, contentItemId });
}

export type CreatorInfo = {
  privacyLevels: string[];
  canPost: boolean;
  maxVideoDurationSec?: number | null;
};

/** TikTok's per-creator audience options (required before a TikTok post). */
export function getCreatorInfo(workspaceId: string, accountId: string): Promise<CreatorInfo> {
  return getJson(
    `/api/social/creator-info?workspaceId=${q(workspaceId)}&accountId=${q(accountId)}`,
  );
}

export type PublicationRow = {
  id: string;
  platform: string;
  account_id: string;
  status: string;
  platform_post_url: string | null;
  platform_post_id: string | null;
  error_category: string | null;
  error_code?: string | null;
  last_error: string | null;
  delivered_at: string | null;
  provider?: string;
  metrics?: {
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
    views?: number;
  } | null;
  metrics_synced_at?: string | null;
};

/** Per-platform delivery status + live links for a content item. */
export function getPublications(
  workspaceId: string,
  contentItemId: string,
): Promise<PublicationRow[]> {
  return getJson(
    `/api/sdr/publications?workspaceId=${q(workspaceId)}&contentItemId=${q(contentItemId)}`,
  );
}

// ─── Analytics ──────────────────────────────────────────────────────────────
export type SocialAnalytics = {
  provider: DistributionProvider | null;
  rangeDays: number;
  totals: {
    deliveries: number;
    published: number;
    failed: number;
    inFlight: number;
    scheduled: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    views: number;
  };
  byPlatform: Array<{
    platform: string;
    published: number;
    failed: number;
    likes: number;
    comments: number;
    shares: number;
    views: number;
  }>;
  topPosts: Array<{
    contentItemId: string;
    title: string;
    platform: string;
    url: string | null;
    publishedAt: string | null;
    likes: number;
    comments: number;
    shares: number;
    views: number;
  }>;
  failures: Array<{
    contentItemId: string;
    title: string;
    platform: string;
    error: string | null;
    at: string;
  }>;
  accounts: { active: number; reconnect: number };
  credits: { used: number; limit: number } | null;
  metricsSyncedAt: string | null;
};

export function getSocialAnalytics(workspaceId: string, days: number): Promise<SocialAnalytics> {
  return getJson(`/api/social/analytics?workspaceId=${q(workspaceId)}&days=${days}`);
}

/** Refresh engagement metrics from the platforms for recent posts. */
export function syncSocialMetrics(
  workspaceId: string,
): Promise<{ posts: number; updated: number }> {
  return postJson("/api/social/metrics/sync", { workspaceId });
}
