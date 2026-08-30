// POST /api/public/hooks/sdr — SDR → RavalAI webhook receiver (FR-021/SC-009).
// Unauthenticated by design (the SDR must reach it); the HMAC signature IS the
// auth — no state change is applied to an unverified callback. C1: 1 MB body cap.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { handleSdrWebhook } from "@/lib/sdr.webhook";

const MAX_BODY_BYTES = 1_000_000;

export const Route = createFileRoute("/api/public/hooks/sdr")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const signature = request.headers.get("x-signature-256");
        const eventType = request.headers.get("x-event-type");
        const out = await handleSdrWebhook(
          { rawBody, signature, eventType, maxBodyBytes: MAX_BODY_BYTES },
          { db: supabaseAdmin },
        );
        return Response.json(out.body, { status: out.status });
      },
    },
  },
});
