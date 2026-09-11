// sdr.webhook.ts — the SDR → RavalAI webhook receiver (FR-021 / SC-009) and the
// item-status aggregation (FR-010/FR-011). Pure + dependency-injected so the
// contract/unit tests run without Supabase. The route passes the raw body +
// headers + a Supabase-like db.
//
// INVARIANT — verification happens before ANY state change, on EVERY event:
//   1. resolve the candidate workspace(s) from the payload (reads only);
//   2. verify the HMAC against that workspace's webhook secret (an empty or
//      missing secret never verifies);
//   3. check freshness — the SDR signs a `timestamp` inside the body, so a
//      captured callback cannot be replayed outside the tolerance window;
//   4. only then apply, scoped to the verified workspace.
// Apply is idempotent + terminal-wins (R2c): a replay is a no-op, and a stale
// `retrying` never downgrades published/failed.
//
// The first version of this receiver handled `account.expired` BEFORE step 2,
// so anyone who knew an account id could mark that account's in-flight
// publications failed with an unsigned request (audit F-SEC-001).
import { verifyWebhookSignature } from "@/lib/sdr.server";
import { decryptSecret } from "@/lib/sdr-provisioning.server";

export type WebhookReceipt = {
  event: string | null;
  workspaceId: string | null;
  outcome: "verified" | "rejected" | "malformed" | "unknown" | "stale";
  reason: string;
  postId?: string | null;
  targetId?: string | null;
  accountId?: string | null;
};

export type WebhookDeps = {
  db: any;
  /** Clock override for tests (ms since epoch). */
  now?: () => number;
  /** Max age of the signed `timestamp`. Default 15 minutes. */
  toleranceSeconds?: number;
  /** Observability sink — one receipt per request, never the body. */
  onReceipt?: (receipt: WebhookReceipt) => void;
};

export type WebhookResult = { status: number; body: any };

const TERMINAL = new Set(["published", "failed", "cancelled"]);
const IN_FLIGHT = ["publishing", "retrying", "pending"];
const DEFAULT_TOLERANCE_SECONDS = 15 * 60;
// The SDR's clock may run slightly ahead of ours.
const MAX_FUTURE_SKEW_MS = 60_000;

/** Aggregate per-destination delivery rows into the content item's editorial
 * status. Cancelled rows are neutral (a fully-cancelled item is back to
 * `approved`). Guarded by the caller: only items with SDR rows are aggregated. */
export function aggregateItemStatus(rows: Array<{ status: string }>): string {
  const active = rows.filter((r) => r.status !== "cancelled");
  if (active.length === 0) return "approved";
  const hasPublished = active.some((r) => r.status === "published");
  const hasFailed = active.some((r) => r.status === "failed");
  const allPublished = active.every((r) => r.status === "published");
  const allFailed = active.every((r) => r.status === "failed");
  // Anything not yet terminal means the item is still being delivered.
  const hasInFlight = active.some((r) => !TERMINAL.has(r.status));
  if (allPublished) return "published";
  if (allFailed) return "failed";
  // `partial_failed` reads as terminal in the UI, so only report it once every
  // destination has settled. Otherwise a 3-target item with one published, one
  // failed and one still publishing would show "partially failed" mid-flight
  // and invite an operator to retry a post that is about to succeed.
  if (hasPublished && hasFailed && !hasInFlight) return "partial_failed";
  return "publishing"; // any in-flight (publishing/pending/retrying)
}

/** Recompute and persist a content item's status from its delivery rows. */
export async function recomputeItemStatus(db: any, contentItemId: string): Promise<string | null> {
  const { data: pubRows } = await db
    .from("content_publications")
    .select("status")
    .eq("content_item_id", contentItemId);
  const aggregated = aggregateItemStatus(pubRows ?? []);
  const { error } = await db
    .from("content_items")
    .update({ status: aggregated, updated_at: new Date().toISOString() })
    .eq("id", contentItemId);
  if (error) throw new Error(error.message);
  return aggregated;
}

/** Freshness check on the SDR-signed body timestamp. Returns a reason on failure. */
export function checkFreshness(
  timestamp: unknown,
  nowMs: number,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): string | null {
  if (typeof timestamp !== "string" || !timestamp) return "missing timestamp";
  const ts = Date.parse(timestamp);
  if (Number.isNaN(ts)) return "invalid timestamp";
  if (ts > nowMs + MAX_FUTURE_SKEW_MS) return "timestamp in the future";
  if (nowMs - ts > toleranceSeconds * 1000) return "stale timestamp";
  return null;
}

async function workspaceSecret(db: any, workspaceId: string): Promise<string> {
  const { data: ws } = await db
    .from("workspace_sdr")
    .select("webhook_secret")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!ws?.webhook_secret) return "";
  try {
    return decryptSecret(ws.webhook_secret);
  } catch {
    return "";
  }
}

/** First candidate workspace whose secret verifies the signature, or null. */
async function verifyAgainst(
  db: any,
  candidates: string[],
  rawBody: string,
  signature: string | null,
): Promise<string | null> {
  for (const workspaceId of candidates) {
    const secret = await workspaceSecret(db, workspaceId);
    if (secret && verifyWebhookSignature(secret, rawBody, signature)) return workspaceId;
  }
  return null;
}

export async function handleSdrWebhook(
  args: {
    rawBody: string;
    signature: string | null;
    eventType: string | null;
    maxBodyBytes?: number;
  },
  deps: WebhookDeps,
): Promise<WebhookResult> {
  const receipt = (r: WebhookReceipt) => {
    try {
      deps.onReceipt?.(r);
    } catch {
      /* observability must never change the response */
    }
  };

  // C1: reject oversized bodies before parsing/verification.
  if (args.maxBodyBytes && args.rawBody.length > args.maxBodyBytes) {
    receipt({ event: null, workspaceId: null, outcome: "malformed", reason: "body too large" });
    return { status: 413, body: { error: "Request too large" } };
  }

  let payload: any;
  try {
    payload = JSON.parse(args.rawBody);
  } catch {
    receipt({ event: null, workspaceId: null, outcome: "malformed", reason: "invalid JSON" });
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  const event: string | null = typeof payload?.event === "string" ? payload.event : null;
  const data = payload?.data ?? {};
  const now = deps.now?.() ?? Date.now();

  // ── 1. Resolve candidate workspace(s). Reads only. ─────────────────────────
  let candidates: string[] = [];
  let row: any = null;
  const ids = {
    postId: (data.post_id as string | undefined) ?? null,
    targetId: (data.target_id as string | undefined) ?? null,
    accountId: (data.account_id as string | undefined) ?? null,
  };

  if (event === "account.expired") {
    if (!ids.accountId) {
      receipt({ event, workspaceId: null, outcome: "malformed", reason: "missing account_id" });
      return { status: 400, body: { error: "account.expired missing account_id" } };
    }
    const { data: rows } = await deps.db
      .from("content_publications")
      .select("workspace_id")
      .eq("account_id", ids.accountId);
    candidates = [
      ...new Set(((rows ?? []) as Array<{ workspace_id: string }>).map((r) => r.workspace_id)),
    ];
    if (candidates.length === 0) {
      receipt({ event, workspaceId: null, outcome: "unknown", reason: "unknown account", ...ids });
      return { status: 404, body: { error: "Unknown account" } };
    }
  } else {
    if (!event || !ids.postId || !ids.targetId) {
      receipt({
        event,
        workspaceId: null,
        outcome: "malformed",
        reason: "malformed payload",
        ...ids,
      });
      return { status: 400, body: { error: "Malformed webhook payload" } };
    }
    const { data: found, error: rowErr } = await deps.db
      .from("content_publications")
      .select("*")
      .eq("sdr_post_id", ids.postId)
      .eq("sdr_target_id", ids.targetId)
      .maybeSingle();
    if (rowErr || !found) {
      receipt({ event, workspaceId: null, outcome: "unknown", reason: "unknown delivery", ...ids });
      return { status: 404, body: { error: "Unknown delivery" } };
    }
    row = found;
    candidates = [found.workspace_id];
  }

  // ── 2. Verify the signature (FR-021). Reject before any mutation. ──────────
  const workspaceId = await verifyAgainst(deps.db, candidates, args.rawBody, args.signature);
  if (!workspaceId) {
    // Observability (Rule 19): an unverified callback is a security signal.
    console.error(`[sdr:webhook] REJECTED unverified ${event}`, ids);
    receipt({
      event,
      workspaceId: candidates[0] ?? null,
      outcome: "rejected",
      reason: "invalid signature",
      ...ids,
    });
    return { status: 401, body: { error: "Invalid signature" } };
  }

  // ── 3. Freshness — a verified but old callback is a replay. ────────────────
  const stale = checkFreshness(payload?.timestamp, now, deps.toleranceSeconds);
  if (stale) {
    console.error(`[sdr:webhook] REJECTED ${stale} ${event}`, ids);
    receipt({ event, workspaceId, outcome: "stale", reason: stale, ...ids });
    return { status: 401, body: { error: "Stale or undated webhook" } };
  }

  // Advisory event-type check (the signed payload is authoritative).
  if (args.eventType && args.eventType !== event) {
    receipt({ event, workspaceId, outcome: "malformed", reason: "event type mismatch", ...ids });
    return { status: 400, body: { error: "Event type mismatch" } };
  }
  console.log(`[sdr:webhook] VERIFIED ${event} workspace=${workspaceId}`);
  receipt({ event, workspaceId, outcome: "verified", reason: "ok", ...ids });

  // ── 4. Apply, scoped to the verified workspace. ────────────────────────────
  if (event === "account.expired") {
    // Mark the account's in-flight publications failed (auth) so the
    // Connections view surfaces Reconnect — only inside the verified workspace.
    const { data: affected } = await deps.db
      .from("content_publications")
      .select("content_item_id, status")
      .eq("account_id", ids.accountId)
      .eq("workspace_id", workspaceId);
    const itemIds = [
      ...new Set(
        ((affected ?? []) as Array<{ content_item_id: string; status: string }>)
          .filter((r) => IN_FLIGHT.includes(r.status))
          .map((r) => r.content_item_id),
      ),
    ];
    const { error } = await deps.db
      .from("content_publications")
      .update({
        status: "failed",
        error_category: "auth",
        last_error: "Account authorization expired",
        updated_at: new Date().toISOString(),
      })
      .eq("account_id", ids.accountId)
      .eq("workspace_id", workspaceId)
      .in("status", IN_FLIGHT);
    if (error) return { status: 500, body: { error: error.message } };
    try {
      for (const itemId of itemIds) await recomputeItemStatus(deps.db, itemId);
    } catch (e) {
      return { status: 500, body: { error: e instanceof Error ? e.message : String(e) } };
    }
    return { status: 200, body: { ok: true, affected_items: itemIds.length } };
  }

  // Terminal-wins (R2c). A published/failed row is never downgraded.
  const status =
    data.status ??
    (event === "post.published" ? "published" : event === "post.retrying" ? "retrying" : "failed");
  const current = row.status;
  const isDowngrade = TERMINAL.has(current) && status !== current;
  if (!isDowngrade) {
    const patch: any = { status, updated_at: new Date().toISOString() };
    if (status === "published") {
      patch.platform_post_id = data.platform_post_id ?? null;
      patch.platform_post_url = data.platform_post_url ?? null;
      patch.delivered_at = new Date().toISOString();
    }
    if (status === "failed" || status === "retrying") {
      patch.error_category = data.error_category ?? null;
      patch.last_error = data.last_error ?? null;
    }
    const { error } = await deps.db
      .from("content_publications")
      .update(patch)
      .eq("sdr_post_id", ids.postId)
      .eq("sdr_target_id", ids.targetId)
      .eq("workspace_id", workspaceId);
    if (error) return { status: 500, body: { error: error.message } };
  }

  // Recompute the item status (aggregation guard: only SDR-managed items —
  // the row above proves it has content_publications rows).
  try {
    const aggregated = await recomputeItemStatus(deps.db, row.content_item_id);
    return { status: 200, body: { ok: true, item_status: aggregated } };
  } catch (e) {
    return { status: 500, body: { error: e instanceof Error ? e.message : String(e) } };
  }
}
