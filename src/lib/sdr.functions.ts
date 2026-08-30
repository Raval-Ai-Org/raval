// sdr.functions.ts — client-side typed surface for the SDR proxy routes
// (US1: connect/manage). Calls the server routes via authedFetch (Supabase Bearer
// attached); the server validates membership + resolves the per-workspace SDR key.
// Never exposes SDR credentials to the browser.
import { authedFetch } from "@/lib/authed-fetch";
import type {
  ConnectedAccount,
  PublishSelection,
  PublishOutcome,
  ScheduleItem,
  ScheduleOutcome,
} from "@/lib/sdr.handlers";

export type OauthStartResult = { authorizationUrl: string; stateToken: string; expiresIn: number };

export type PublishResult = { results: PublishOutcome[] };
export type ScheduleResult = { results: ScheduleOutcome[] };

/** Plain-language client messages per SDR error code (see sdr.server.ts
 * SdrErrorCode). The technical `detail` is kept as a secondary support line so
 * a user can still report it, but the primary message is human-readable. */
const SDR_ERROR_MESSAGES: Record<string, string> = {
  SDR_UNREACHABLE:
    "The Social Distribution Engine is not responding. Please try again in a moment.",
  ACCOUNT_EXPIRED:
    "This social account's authorization has expired. Reconnect it to publish again.",
  PLATFORM_VALIDATION:
    "This post doesn't meet the platform's requirements. Check the message and try again.",
  DUPLICATE: "This post was already submitted — no duplicate will be created.",
  NOT_FOUND: "The item you're looking for couldn't be found.",
  UNAUTHORIZED: "You don't have permission to do this.",
  UNKNOWN: "Something went wrong while publishing. Please try again.",
};

function describeSdrError(
  j: { error?: { code?: string; detail?: string } },
  status: number,
): string {
  const code = j?.error?.code ?? "";
  const detail = j?.error?.detail ?? "";
  // Platform validation carries a real reason worth showing verbatim (e.g.
  // "Instagram requires exactly one media item attached to the post.").
  if (code === "PLATFORM_VALIDATION" && detail) return detail;
  const friendly = SDR_ERROR_MESSAGES[code] ?? `Request failed (${status})`;
  return detail ? `${friendly} (${detail})` : friendly;
}

async function extractError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return describeSdrError(j, res.status);
  } catch {
    return `Request failed (${res.status})`;
  }
}

/** List the workspace's connected accounts (FR-002). */
export async function getConnections(workspaceId: string): Promise<ConnectedAccount[]> {
  const res = await authedFetch(`/api/sdr/accounts?workspaceId=${encodeURIComponent(workspaceId)}`);
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Disconnect an account (FR-003). */
export async function disconnectAccount(workspaceId: string, accountId: string): Promise<void> {
  const res = await authedFetch("/api/sdr/disconnect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, accountId }),
  });
  if (!res.ok) throw new Error(await extractError(res));
}

/** Start the OAuth connect/reconnect flow (FR-001/FR-004); returns the platform
 * consent URL to open. Completion lands on the SDR callback, then the Connections
 * view refreshes. */
export async function oauthStart(workspaceId: string, platform: string): Promise<OauthStartResult> {
  const res = await authedFetch("/api/sdr/oauth/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, platform }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Publish approved content items to the selected destinations (FR-005..007). */
export async function publishContentItems(
  workspaceId: string,
  contentItemIds: string[],
  selection: PublishSelection,
): Promise<PublishResult> {
  const res = await authedFetch("/api/sdr/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, contentItemIds, selection }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Schedule content items for automatic on-time publishing (FR-008/FR-025). */
export async function scheduleContentItems(
  workspaceId: string,
  items: ScheduleItem[],
  selection: PublishSelection,
): Promise<ScheduleResult> {
  const res = await authedFetch("/api/sdr/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, items, selection }),
  });
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}

/** Cancel a scheduled item before it fires (FR-009). */
export async function cancelScheduled(workspaceId: string, contentItemId: string): Promise<void> {
  const res = await authedFetch("/api/sdr/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId, contentItemId }),
  });
  if (!res.ok && res.status !== 204) throw new Error(await extractError(res));
}

export type PublicationRow = {
  id: string;
  platform: string;
  account_id: string;
  status: string;
  platform_post_url: string | null;
  platform_post_id: string | null;
  error_category: string | null;
  last_error: string | null;
  delivered_at: string | null;
};

/** Per-platform delivery status + live links for a content item (FR-010).
 * Re-fetched by the Studio on content:changed so webhook-driven updates appear
 * without a manual refresh (US4 / R2d). */
export async function getPublications(
  workspaceId: string,
  contentItemId: string,
): Promise<PublicationRow[]> {
  const res = await authedFetch(
    `/api/sdr/publications?workspaceId=${encodeURIComponent(workspaceId)}&contentItemId=${encodeURIComponent(contentItemId)}`,
  );
  if (!res.ok) throw new Error(await extractError(res));
  return res.json();
}
