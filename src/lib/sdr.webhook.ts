// sdr.webhook.ts — the SDR → RavalAI webhook receiver (FR-021 / SC-009) and the
// item-status aggregation (FR-010/FR-011). Pure + dependency-injected so the
// contract/unit tests run without Supabase. The route passes the raw body +
// headers + a Supabase-like db.
//
// Verification MUST happen before ANY state change: the receiver resolves the
// delivery row (no state change), looks up the workspace's webhook secret, and
// rejects unverified callbacks with 401. Apply is idempotent + terminal-wins
// (R2c): a replay is a no-op, and a stale `retrying` never downgrades
// published/failed.
import { verifyWebhookSignature } from "@/lib/sdr.server";
import { decryptSecret } from "@/lib/sdr-provisioning.server";

export type WebhookDeps = { db: any };

export type WebhookResult = { status: number; body: any };

const TERMINAL = new Set(["published", "failed", "cancelled"]);

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
  if (allPublished) return "published";
  if (allFailed) return "failed";
  if (hasPublished && hasFailed) return "partial_failed"; // some live, some dead
  return "publishing"; // any in-flight (publishing/pending/retrying)
}

export async function handleSdrWebhook(
  args: { rawBody: string; signature: string | null; eventType: string | null; maxBodyBytes?: number },
  deps: WebhookDeps,
): Promise<WebhookResult> {
  // C1: reject oversized bodies before parsing/verification.
  if (args.maxBodyBytes && args.rawBody.length > args.maxBodyBytes) {
    return { status: 413, body: { error: "Request too large" } };
  }

  let payload: any;
  try {
    payload = JSON.parse(args.rawBody);
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  const event: string | undefined = payload?.event;
  const data = payload?.data ?? {};

  // account.expired: account-level event (no target); mark its in-flight
  // publications failed (auth) so the Connections view surfaces Reconnect.
  if (event === "account.expired") {
    const accountId = data.account_id;
    if (!accountId) return { status: 400, body: { error: "account.expired missing account_id" } };
    const { error } = await deps.db
      .from("content_publications")
      .update({ status: "failed", error_category: "auth", last_error: "Account authorization expired", updated_at: new Date().toISOString() })
      .eq("account_id", accountId)
      .in("status", ["publishing", "retrying", "pending"]);
    if (error) return { status: 500, body: { error: error.message } };
    return { status: 200, body: { ok: true } };
  }

  const postId: string | undefined = data.post_id;
  const targetId: string | undefined = data.target_id;
  if (!event || !postId || !targetId) {
    return { status: 400, body: { error: "Malformed webhook payload" } };
  }

  // 1. Resolve the delivery row (the workspace + item key). No state change yet.
  const { data: row, error: rowErr } = await deps.db
    .from("content_publications")
    .select("*")
    .eq("sdr_post_id", postId)
    .eq("sdr_target_id", targetId)
    .maybeSingle();
  if (rowErr || !row) return { status: 404, body: { error: "Unknown delivery" } };

  // 2. Resolve the workspace webhook secret + VERIFY (FR-021). Reject unverified.
  const { data: ws } = await deps.db
    .from("workspace_sdr")
    .select("webhook_secret")
    .eq("workspace_id", row.workspace_id)
    .maybeSingle();
  const secret = ws?.webhook_secret ? decryptSecret(ws.webhook_secret) : "";
  if (!verifyWebhookSignature(secret, args.rawBody, args.signature)) {
    // Observability (Rule 19): an unverified callback is a security signal.
    console.error(`[sdr:webhook] REJECTED unverified ${event} post=${postId} target=${targetId}`);
    return { status: 401, body: { error: "Invalid signature" } };
  }
  console.log(`[sdr:webhook] VERIFIED ${event} post=${postId} target=${targetId}`);

  // Advisory event-type check (the signed payload is authoritative).
  if (args.eventType && args.eventType !== event) {
    return { status: 400, body: { error: "Event type mismatch" } };
  }

  // 3. Apply terminal-wins (R2c). A published/failed row is never downgraded.
  const status = data.status ?? (event === "post.published" ? "published" : event === "post.retrying" ? "retrying" : "failed");
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
      .eq("sdr_post_id", postId)
      .eq("sdr_target_id", targetId);
    if (error) return { status: 500, body: { error: error.message } };
  }

  // 4. Recompute the item status (aggregation guard: only SDR-managed items —
  //    the row above proves it has content_publications rows).
  const { data: pubRows } = await deps.db
    .from("content_publications")
    .select("status")
    .eq("content_item_id", row.content_item_id);
  const aggregated = aggregateItemStatus(pubRows ?? []);
  const { error: itemErr } = await deps.db
    .from("content_items")
    .update({ status: aggregated, updated_at: new Date().toISOString() })
    .eq("id", row.content_item_id);
  if (itemErr) return { status: 500, body: { error: itemErr.message } };

  return { status: 200, body: { ok: true, item_status: aggregated } };
}
