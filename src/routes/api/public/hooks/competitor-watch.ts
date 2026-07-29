import { createFileRoute } from "@tanstack/react-router";

// Cron hook — invoked by pg_cron on a schedule. Authenticates with the
// Supabase publishable key (apikey header). Scans watches whose
// last_checked_at is stale and inserts alerts.
export const Route = createFileRoute("/api/public/hooks/competitor-watch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { timingSafeEqual } = await import("crypto");
        // Only accept a dedicated cron secret — never fall back to the
        // service-role key (which would leak the DB super-key over the wire).
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
          const { runDueCompetitorScans } = await import("@/lib/competitor-watch.server");
          const out = await runDueCompetitorScans({ max: 40 });
          return Response.json({ ok: true, ...out });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("competitor-watch cron error", msg);
          return new Response(JSON.stringify({ ok: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
      GET: async () => Response.json({ ok: true, hint: "POST with apikey header" }),
    },
  },
});
