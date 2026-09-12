// GET /api/health/ready — readiness probe for the load balancer / uptime
// monitor. 200 only when the database answers, Redis answers (if configured)
// and no scheduler heartbeat is overdue; otherwise 503 with which check
// failed. No configuration values, model ids or secrets are exposed.
// /api/health stays a cheap liveness probe (process up).
import { missedHeartbeats, type Heartbeat } from "@/server/observability/ops-watch";

export const dynamic = "force-dynamic";

async function timed<T>(fn: () => Promise<T>, ms = 3000): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export async function GET() {
  const checks: Record<string, "ok" | "fail" | "skipped" | string> = {};
  let ok = true;

  // Database reachability is checked against a table that exists in every
  // revision of the schema, so "migrations not applied yet" cannot masquerade
  // as "the database is down" — they need different responses from an operator.
  let databaseUp = false;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await timed(async () =>
      supabaseAdmin.from("workspaces").select("id", { count: "exact", head: true }),
    );
    if (error) throw new Error(error.message);
    checks.database = "ok";
    databaseUp = true;
  } catch {
    checks.database = "fail";
    ok = false;
  }

  if (databaseUp) {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await timed(async () =>
        supabaseAdmin
          .from("cron_heartbeats")
          .select("job, expected_interval_seconds, last_succeeded_at, last_started_at, last_error"),
      );
      if (error) throw new Error(error.message);
      const missed = missedHeartbeats((data ?? []) as Heartbeat[]).map((h) => h.job);
      checks.scheduler = missed.length
        ? `missed: ${missed.join(", ")}`
        : (data ?? []).length
          ? "ok"
          : "no heartbeats yet";
      if (missed.length) ok = false;
    } catch {
      // The table only exists from migration 20260911120400 onward.
      checks.scheduler = "unavailable (migrations pending?)";
      ok = false;
    }
  }

  if (process.env.REDIS_URL) {
    try {
      const { cache } = await import("@/server/cache/store");
      await timed(() => cache.set("health:ping", Date.now(), 30));
      checks.cache = cache.backend() === "redis" ? "ok" : "fail (in-process fallback)";
      if (cache.backend() !== "redis") ok = false;
    } catch {
      checks.cache = "fail";
      ok = false;
    }
  } else {
    checks.cache = "skipped (REDIS_URL not set)";
  }

  return Response.json(
    { status: ok ? "ready" : "degraded", checks, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
