// POST /api/public/hooks/sdr-reconcile — reconciliation backstop (FR-018),
// invoked by a Supabase pg_cron row. Guarded with CRON_SECRET (mirrors
// run-schedules.ts). Sweeps stale publishing/pending/retrying publications
// against the SDR job state so nothing strands in "publishing".
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reconcileStalePublications } from "@/lib/sdr.reconcile";
import { getWorkspaceSdrKey } from "@/lib/sdr.helpers.server";

export const Route = createFileRoute("/api/public/hooks/sdr-reconcile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.CRON_SECRET ?? "";
        const provided = request.headers.get("x-cron-secret") ?? "";
        if (!expected || expected.length < 16) {
          return new Response("Server not configured", { status: 503 });
        }
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const out = await reconcileStalePublications({
            db: supabaseAdmin,
            sdrBaseUrl: process.env.SDR_BASE_URL ?? "",
            getToken: getWorkspaceSdrKey,
          });
          return Response.json(out);
        } catch (e) {
          console.error("sdr-reconcile error", e);
          return new Response(
            JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
