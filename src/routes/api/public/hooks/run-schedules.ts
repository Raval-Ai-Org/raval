import { createFileRoute } from "@tanstack/react-router";

// Cron hook — invoked every minute by pg_cron. Authenticates with the
// Supabase publishable key (apikey header). No PII is returned.
export const Route = createFileRoute("/api/public/hooks/run-schedules")({
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
          const { runDueScheduledJobs } = await import("@/lib/schedules.server");
          const out = await runDueScheduledJobs({ max: 25 });
          return Response.json({ ok: true, ran: out.ran });
        } catch (e) {
          console.error("run-schedules error", e);
          const msg = e instanceof Error ? e.message : String(e);
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