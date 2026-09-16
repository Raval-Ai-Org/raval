// POST /api/public/hooks/kie — Kie.ai task completion callback. Verified with
// Kie's HMAC signature (KIE_WEBHOOK_HMAC_KEY); a verified callback only makes
// the matching render due now — the engine re-reads the task from Kie, so the
// callback body is never trusted for status, video URL or cost. Idempotent:
// repeated callbacks find the render already advanced.
import { after } from "next/server";
import { verifyKieCallback } from "@/server/ugc/webhook.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const rawBody = await request.text();
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
  const row = await supabaseUgcStore.findByProviderTask("kie", verdict.taskId);
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
