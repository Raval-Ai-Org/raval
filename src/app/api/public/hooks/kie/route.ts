// POST /api/public/hooks/kie — Kie.ai task completion callback. Verified with
// Kie's HMAC signature (KIE_WEBHOOK_HMAC_KEY); a verified callback only makes
// the matching render due now — the engine re-reads the task from Kie, so the
// callback body is never trusted for status, video URL or cost. Idempotent:
// repeated callbacks find the render already advanced.
import { after } from "next/server";
import { readWebhookBody } from "@/server/request-body";
import { verifiedRenderRef, verifyKieCallback } from "@/server/ugc/webhook.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const rawBody = await readWebhookBody(request);
  if (rawBody instanceof Response) return rawBody;
  const verdict = verifyKieCallback({
    rawBody,
    signature: request.headers.get("x-webhook-signature"),
    timestamp: request.headers.get("x-webhook-timestamp"),
    key: process.env.KIE_WEBHOOK_HMAC_KEY?.trim(),
  });
  if (!verdict.ok) {
    return Response.json({ ok: false, error: verdict.reason }, { status: verdict.status });
  }

  const { supabaseUgcStore } = await import("@/server/ugc/store.supabase.server");
  let row = await supabaseUgcStore.findByProviderTask("kie", verdict.taskId);
  if (!row) {
    // A task no render knows, from a URL that names a render (signed by us):
    // its create call timed out, so the render waits for exactly this. The
    // engine re-reads the task from Kie, so adopting it trusts nothing more.
    const renderId = verifiedRenderRef(
      new URL(request.url),
      process.env.KIE_WEBHOOK_HMAC_KEY?.trim(),
    );
    if (renderId) {
      const { renderEngine } = await import("@/server/ugc/service.server");
      row = await renderEngine.adopt(renderId, verdict.taskId, "kie");
    }
  }
  // Not a UGC render (e.g. a Studio task): acknowledge so Kie stops retrying.
  if (!row) return Response.json({ ok: true, ignored: true });

  if (row.status === "processing") {
    await supabaseUgcStore.transition(row.id, ["processing"], {
      next_attempt_at: new Date().toISOString(),
    });
    after(async () => {
      const { renderEngine } = await import("@/server/ugc/service.server");
      await renderEngine.runDue({ worker: "kie-callback", budgetMs: 50_000, max: 1, id: row.id });
    });
  }
  return Response.json({ ok: true });
}
