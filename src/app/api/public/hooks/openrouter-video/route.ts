// POST /api/public/hooks/openrouter-video — OpenRouter video job callback
// (callback_url set by src/server/ugc/providers/openrouter.server.ts). Verified
// with OpenRouter's HMAC signature (OPENROUTER_WEBHOOK_SECRET); a verified
// callback only makes the matching render due now — the engine re-reads the
// job from OpenRouter, so the body is never trusted for status, file or cost.
// Idempotent: repeated deliveries (same X-OpenRouter-Idempotency-Key) find the
// render already advanced.
import { after } from "next/server";
import { verifyOpenRouterCallback } from "@/server/ugc/webhook.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const rawBody = await request.text();
  const verdict = verifyOpenRouterCallback({
    rawBody,
    signature: request.headers.get("x-openrouter-signature"),
    secret: process.env.OPENROUTER_WEBHOOK_SECRET?.trim(),
  });
  if (!verdict.ok) {
    return Response.json({ ok: false, error: verdict.reason }, { status: verdict.status });
  }

  const { supabaseUgcStore } = await import("@/server/ugc/store.supabase.server");
  const row = await supabaseUgcStore.findByProviderTask("openrouter", verdict.taskId);
  // Not a UGC render (e.g. a Studio task, advanced by its own polling): acknowledge.
  if (!row) return Response.json({ ok: true, ignored: true });

  if (row.status === "processing") {
    await supabaseUgcStore.transition(row.id, ["processing"], {
      next_attempt_at: new Date().toISOString(),
    });
    after(async () => {
      const { renderEngine } = await import("@/server/ugc/service.server");
      await renderEngine.runDue({
        worker: "openrouter-callback",
        budgetMs: 50_000,
        max: 1,
        id: row.id,
      });
    });
  }
  return Response.json({ ok: true });
}
