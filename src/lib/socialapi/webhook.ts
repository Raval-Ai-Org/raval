// webhook.ts — SocialAPI.ai → Mellox webhook receiver. Pure + injected.
//
// Verification (docs: guides/webhooks, "Replay protection"):
//   X-SocialAPI-Signature-V2 = "sha256=" + HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
//   X-SocialAPI-Timestamp    = unix seconds of this delivery attempt
//   X-SocialAPI-Delivery     = stable across retries → deduplication key
//
// INVARIANT: nothing is read from or written to tenant data before the
// signature and timestamp verify. The one exception the provider requires is
// the `webhook.test` registration ping, which is answered 200 with no effect.
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  applyPostSnapshot,
  recomputeSocialItemStatus,
  syncPostHandler,
  type ProviderPost,
} from "@/lib/socialapi/handlers";
import type { SocialApiCall } from "@/lib/socialapi/client.server";

export type SocialWebhookReceipt = {
  provider: "socialapi";
  event: string | null;
  workspaceId: string | null;
  outcome: "verified" | "rejected" | "stale" | "unknown" | "malformed" | "duplicate" | "ignored";
  reason: string;
  postId?: string | null;
  accountId?: string | null;
  deliveryId?: string | null;
};

export type SocialWebhookDeps = {
  db: any;
  secret: string;
  /** Used to fetch the authoritative post when a payload carries no results. */
  api?: SocialApiCall;
  now?: () => number;
  toleranceSeconds?: number;
  /**
   * Claim a delivery id before applying (unique per provider). Returns false
   * when it was already processed. `release` undoes a claim if apply fails so
   * the provider's retry is not swallowed.
   */
  claimDelivery?: (receipt: SocialWebhookReceipt) => Promise<boolean>;
  releaseDelivery?: (deliveryId: string) => Promise<void>;
  onReceipt?: (receipt: SocialWebhookReceipt) => void;
};

export type SocialWebhookInput = {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  deliveryId: string | null;
  eventHeader: string | null;
  maxBodyBytes?: number;
};

const DEFAULT_TOLERANCE_SECONDS = 300;

export function signSocialApiPayload(secret: string, timestamp: string, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifySocialApiSignature(args: {
  secret: string;
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  nowMs: number;
  toleranceSeconds?: number;
}): "ok" | "invalid" | "stale" {
  // An empty key is not a secret: anyone can compute HMAC("").
  if (!args.secret || !args.signature || !args.timestamp) return "invalid";
  if (!/^\d{9,11}$/.test(args.timestamp)) return "invalid";
  const expected = Buffer.from(signSocialApiPayload(args.secret, args.timestamp, args.rawBody));
  const provided = Buffer.from(args.signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return "invalid";
  const age = Math.abs(args.nowMs / 1000 - Number(args.timestamp));
  return age > (args.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS) ? "stale" : "ok";
}

const POST_RESULT_EVENTS = new Set(["post.published", "post.partial", "post.failed"]);

export async function handleSocialApiWebhook(
  input: SocialWebhookInput,
  deps: SocialWebhookDeps,
): Promise<{ status: number; body: unknown }> {
  const now = deps.now?.() ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const receipt = (r: Omit<SocialWebhookReceipt, "provider">) => {
    try {
      deps.onReceipt?.({ provider: "socialapi", ...r });
    } catch {
      /* observability never changes the response */
    }
  };
  const base = { deliveryId: input.deliveryId };

  if (input.maxBodyBytes && Buffer.byteLength(input.rawBody) > input.maxBodyBytes) {
    receipt({
      event: null,
      workspaceId: null,
      outcome: "malformed",
      reason: "body too large",
      ...base,
    });
    return { status: 413, body: { error: "Request too large" } };
  }

  // Registration ping: the secret is only revealed after it succeeds, so it
  // cannot be verified. Acknowledge and do nothing.
  if (input.eventHeader === "webhook.test") {
    receipt({
      event: "webhook.test",
      workspaceId: null,
      outcome: "ignored",
      reason: "registration ping",
      ...base,
    });
    return { status: 200, body: { ok: true } };
  }

  if (!deps.secret) {
    console.error("[socialapi:webhook] SOCIALAPI_WEBHOOK_SECRET is not configured — rejecting");
    receipt({
      event: input.eventHeader,
      workspaceId: null,
      outcome: "rejected",
      reason: "no secret configured",
      ...base,
    });
    return { status: 503, body: { error: "Webhook receiver not configured" } };
  }

  const verdict = verifySocialApiSignature({
    secret: deps.secret,
    rawBody: input.rawBody,
    timestamp: input.timestamp,
    signature: input.signature,
    nowMs: now,
    toleranceSeconds: deps.toleranceSeconds,
  });
  if (verdict !== "ok") {
    console.error(`[socialapi:webhook] REJECTED ${verdict} ${input.eventHeader ?? "?"}`);
    receipt({
      event: input.eventHeader,
      workspaceId: null,
      outcome: verdict === "stale" ? "stale" : "rejected",
      reason: verdict === "stale" ? "stale timestamp" : "invalid signature",
      ...base,
    });
    return { status: 401, body: { error: "Invalid signature" } };
  }

  let payload: any;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    receipt({
      event: input.eventHeader,
      workspaceId: null,
      outcome: "malformed",
      reason: "invalid JSON",
      ...base,
    });
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  const event: string | null = typeof payload?.event === "string" ? payload.event : null;
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  if (!event || (input.eventHeader && input.eventHeader !== event)) {
    receipt({
      event,
      workspaceId: null,
      outcome: "malformed",
      reason: "event type mismatch",
      ...base,
    });
    return { status: 400, body: { error: "Malformed webhook payload" } };
  }
  const ids = {
    postId: typeof data.post_id === "string" ? data.post_id : null,
    accountId: typeof data.account_id === "string" ? data.account_id : null,
  };

  // Deduplicate on the delivery id (stable across provider retries).
  let claimed = false;
  if (input.deliveryId && deps.claimDelivery) {
    const fresh = await deps.claimDelivery({
      provider: "socialapi",
      event,
      workspaceId: null,
      outcome: "verified",
      reason: "ok",
      ...ids,
      ...base,
    });
    if (!fresh) {
      receipt({
        event,
        workspaceId: null,
        outcome: "duplicate",
        reason: "already processed",
        ...ids,
        ...base,
      });
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    claimed = true;
  } else {
    receipt({ event, workspaceId: null, outcome: "verified", reason: "ok", ...ids, ...base });
  }

  try {
    const result = await applyEvent(event, data, ids, { ...deps, nowIso });
    return { status: 200, body: { ok: true, ...result } };
  } catch (e) {
    if (claimed && input.deliveryId)
      await deps.releaseDelivery?.(input.deliveryId).catch(() => undefined);
    console.error("[socialapi:webhook] apply failed", event, e instanceof Error ? e.message : e);
    return { status: 500, body: { error: "Webhook processing failed" } };
  }
}

async function applyEvent(
  event: string,
  data: any,
  ids: { postId: string | null; accountId: string | null },
  deps: SocialWebhookDeps & { nowIso: string },
): Promise<Record<string, unknown>> {
  if (POST_RESULT_EVENTS.has(event) || event === "post.retried" || event === "post.deleted") {
    if (!ids.postId) return { ignored: "missing post_id" };
    const { data: rows } = await deps.db
      .from("content_publications")
      .select("workspace_id")
      .eq("provider", "socialapi")
      .eq("sdr_post_id", ids.postId)
      .limit(1);
    const workspaceId = (rows ?? [])[0]?.workspace_id as string | undefined;
    // Posts created outside Mellox (e.g. the provider dashboard) are not ours.
    if (!workspaceId) return { ignored: "unknown post" };

    if (POST_RESULT_EVENTS.has(event) && Array.isArray(data.results)) {
      const post: ProviderPost = {
        id: ids.postId,
        status: typeof data.status === "string" ? data.status : event.slice(5),
        targets: data.results,
        retry_count: typeof data.retry_count === "number" ? data.retry_count : undefined,
      };
      // Webhook results carry no retry_count; the latest terminal result wins.
      const touched = await applyPostSnapshot(
        deps.db,
        { ...post, retry_count: post.retry_count ?? Number.MAX_SAFE_INTEGER },
        {
          now: deps.nowIso,
          workspaceId,
        },
      );
      for (const itemId of touched) await recomputeSocialItemStatus(deps.db, itemId);
      return { workspaceId, touched: touched.length };
    }

    if (event === "post.deleted") {
      const touched = await applyPostSnapshot(
        deps.db,
        { id: ids.postId, status: "cancelled", targets: [] },
        { now: deps.nowIso, workspaceId },
      );
      for (const itemId of touched) await recomputeSocialItemStatus(deps.db, itemId);
      return { workspaceId, touched: touched.length };
    }

    // post.retried, or a result event without a results array: read the truth.
    if (deps.api) {
      const synced = await syncPostHandler(
        { workspaceId, postId: ids.postId },
        { api: deps.api, db: deps.db },
      );
      return { workspaceId, touched: synced.touched.length };
    }
    return { workspaceId, deferred: "reconcile" };
  }

  if (event === "account.disconnected" || event === "account.connected") {
    if (!ids.accountId) return { ignored: "missing account_id" };
    if (event === "account.disconnected") {
      const reconnect = data.reconnect_required === true;
      const { error } = await deps.db
        .from("social_accounts")
        .update({
          status: reconnect ? "reconnect_required" : "disconnected",
          reconnect_reason: reconnect ? String(data.reason ?? "access_revoked") : null,
          ...(reconnect ? {} : { disconnected_at: deps.nowIso }),
          updated_at: deps.nowIso,
        })
        .eq("provider", "socialapi")
        .eq("provider_account_id", ids.accountId);
      if (error) throw new Error(error.message);
      return { account: ids.accountId };
    }
    // account.connected: only mirror accounts under a brand we map to a workspace.
    const brandId = typeof data.brand_id === "string" ? data.brand_id : null;
    if (!brandId) return { ignored: "missing brand_id" };
    const { data: ws } = await deps.db
      .from("workspace_socialapi")
      .select("workspace_id")
      .eq("brand_id", brandId)
      .maybeSingle();
    if (!ws?.workspace_id) return { ignored: "unknown brand" };
    const { error } = await deps.db.from("social_accounts").upsert(
      {
        workspace_id: ws.workspace_id,
        provider: "socialapi",
        provider_account_id: ids.accountId,
        brand_id: brandId,
        platform: String(data.platform ?? "unknown"),
        username: data.username ?? null,
        display_name: data.display_name ?? null,
        avatar_url: data.profile_picture_url ?? null,
        status: "active",
        reconnect_reason: null,
        disconnected_at: null,
        last_synced_at: deps.nowIso,
        updated_at: deps.nowIso,
      },
      { onConflict: "provider,provider_account_id" },
    );
    if (error) throw new Error(error.message);
    return { workspaceId: ws.workspace_id, account: ids.accountId };
  }

  // post.scheduled / post.updated / post.unpublished / inbox events: nothing to
  // mirror (Mellox already recorded the schedule when it created the post).
  return { ignored: event };
}
