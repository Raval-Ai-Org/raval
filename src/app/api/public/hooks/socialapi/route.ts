// POST /api/public/hooks/socialapi — SocialAPI.ai → Mellox webhook receiver.
// Unauthenticated by design; the v2 HMAC signature + timestamp IS the auth
// (src/lib/socialapi/webhook.ts). 1 MB body cap. Verified deliveries claim
// their X-SocialAPI-Delivery id in sdr_webhook_events (unique), which is both
// the receipt log and the deduplication key; every rejection is logged too.
import { handleSocialApiWebhook, type SocialWebhookReceipt } from "@/lib/socialapi/webhook";
import { getSocialApiClient, socialDb } from "@/lib/socialapi/workspace.server";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;

function toleranceSeconds(): number | undefined {
  const raw = Number(process.env.SOCIALAPI_WEBHOOK_TOLERANCE_SECONDS);
  return Number.isFinite(raw) && raw >= 60 ? raw : undefined;
}

function receiptRow(r: SocialWebhookReceipt) {
  return {
    provider: "socialapi",
    event: r.event,
    workspace_id: r.workspaceId,
    outcome: r.outcome,
    reason: r.reason,
    sdr_post_id: r.postId ?? null,
    account_id: r.accountId ?? null,
    delivery_id: r.outcome === "verified" ? (r.deliveryId ?? null) : null,
  };
}

function recordReceipt(r: SocialWebhookReceipt): void {
  void socialDb
    .from("sdr_webhook_events")
    .insert(receiptRow(r))
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.error("[socialapi:webhook] receipt not recorded", error.message);
    });
}

async function claimDelivery(r: SocialWebhookReceipt): Promise<boolean> {
  const { error } = await socialDb.from("sdr_webhook_events").insert(receiptRow(r));
  if (!error) return true;
  if (error.code === "23505") return false;
  // Logging is unavailable: process anyway (handlers are terminal-wins idempotent).
  console.error("[socialapi:webhook] delivery claim failed", error.message);
  return true;
}

async function releaseDelivery(deliveryId: string): Promise<void> {
  await socialDb
    .from("sdr_webhook_events")
    .delete()
    .eq("provider", "socialapi")
    .eq("delivery_id", deliveryId)
    .eq("outcome", "verified");
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const header = (name: string) => request.headers.get(name);
  const out = await handleSocialApiWebhook(
    {
      rawBody,
      signature: header("x-socialapi-signature-v2"),
      timestamp: header("x-socialapi-timestamp"),
      deliveryId: header("x-socialapi-delivery"),
      eventHeader: header("x-socialapi-event"),
      maxBodyBytes: MAX_BODY_BYTES,
    },
    {
      db: socialDb,
      secret: process.env.SOCIALAPI_WEBHOOK_SECRET ?? "",
      api: process.env.SOCIALAPI_API_KEY ? getSocialApiClient() : undefined,
      toleranceSeconds: toleranceSeconds(),
      claimDelivery,
      releaseDelivery,
      onReceipt: recordReceipt,
    },
  );
  return Response.json(out.body, { status: out.status });
}
