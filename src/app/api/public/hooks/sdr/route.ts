// POST /api/public/hooks/sdr — SDR → RavalAI webhook receiver (FR-021/SC-009).
// Unauthenticated by design (the SDR must reach it); the HMAC signature IS the
// auth — no state change is applied to an unverified or stale callback.
// C1: 1 MB body cap. Every receipt (verified or rejected, never the body) is
// recorded in sdr_webhook_events — the reliability worker reads rejection
// spikes from there.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { handleSdrWebhook, type WebhookReceipt } from "@/lib/sdr.webhook";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;

function toleranceSeconds(): number | undefined {
  const raw = Number(process.env.SDR_WEBHOOK_TOLERANCE_SECONDS);
  return Number.isFinite(raw) && raw >= 60 ? raw : undefined;
}

function recordReceipt(r: WebhookReceipt): void {
  void supabaseAdmin
    .from("sdr_webhook_events")
    .insert({
      event: r.event,
      workspace_id: r.workspaceId,
      outcome: r.outcome,
      reason: r.reason,
      sdr_post_id: r.postId ?? null,
      sdr_target_id: r.targetId ?? null,
      account_id: r.accountId ?? null,
    })
    .then(({ error }) => {
      if (error) console.error("[sdr:webhook] receipt not recorded", error.message);
    });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature-256");
  const eventType = request.headers.get("x-event-type");
  const out = await handleSdrWebhook(
    { rawBody, signature, eventType, maxBodyBytes: MAX_BODY_BYTES },
    { db: supabaseAdmin, toleranceSeconds: toleranceSeconds(), onReceipt: recordReceipt },
  );
  return Response.json(out.body, { status: out.status });
}
