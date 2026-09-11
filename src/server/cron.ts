// cron.ts — the kernel every /api/public/hooks/* cron endpoint is built on.
//
//   export const POST = defineCronRoute({
//     job: "sdr-reconcile",
//     expectedIntervalSeconds: 300,
//     handler: async () => reconcileStalePublications(...),
//   });
//
// One implementation of the CRON_SECRET check (503 when unset or shorter than
// 16 chars, 401 on mismatch, timing-safe compare — no fallback to the
// service-role key), plus a heartbeat per job in public.cron_heartbeats:
// start, success/failure, duration, a short result. /api/health/ready and the
// ops-watch job read those heartbeats to alert when a run is missed.
import "server-only";
import { timingSafeEqual } from "node:crypto";
import { runWithRequest, setRequestScope } from "./request-context";

export type CronRouteOptions = {
  /** Heartbeat key, e.g. "run-schedules". */
  job: string;
  /** How often pg_cron calls it; "missed" = no success within 3× this. */
  expectedIntervalSeconds: number;
  handler: (request: Request) => Promise<unknown>;
};

export function cronSecretError(request: Request): Response | null {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected || expected.length < 16) {
    return new Response("Server not configured", { status: 503 });
  }
  const provided = Buffer.from(request.headers.get("x-cron-secret") ?? "");
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return null;
}

export type HeartbeatSink = {
  start(job: string, expectedIntervalSeconds: number): Promise<void>;
  finish(job: string, ok: boolean, durationMs: number, detail: unknown): Promise<void>;
};

const supabaseHeartbeats: HeartbeatSink = {
  async start(job, expectedIntervalSeconds) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("cron_heartbeats").upsert(
      {
        job,
        expected_interval_seconds: expectedIntervalSeconds,
        last_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "job" },
    );
  },
  async finish(job, ok, durationMs, detail) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("cron_heartbeats")
      .select("run_count, failure_count")
      .eq("job", job)
      .maybeSingle();
    const now = new Date().toISOString();
    await supabaseAdmin
      .from("cron_heartbeats")
      .update({
        ...(ok
          ? { last_succeeded_at: now, last_error: null }
          : { last_failed_at: now, last_error: String(detail).slice(0, 500) }),
        last_duration_ms: durationMs,
        last_result: ok ? (JSON.parse(JSON.stringify(detail ?? null)) as never) : null,
        run_count: (data?.run_count ?? 0) + 1,
        failure_count: (data?.failure_count ?? 0) + (ok ? 0 : 1),
        updated_at: now,
      })
      .eq("job", job);
  },
};

let heartbeats: HeartbeatSink = supabaseHeartbeats;

/** Tests swap the heartbeat sink. */
export function setHeartbeatSink(next: HeartbeatSink | null): void {
  heartbeats = next ?? supabaseHeartbeats;
}

async function safely(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    console.error("[cron] heartbeat not recorded", error instanceof Error ? error.message : error);
  }
}

export function defineCronRoute(opts: CronRouteOptions) {
  return (request: Request) =>
    runWithRequest(request, async () => {
      const denied = cronSecretError(request);
      if (denied) return denied;
      setRequestScope({ route: `cron.${opts.job}` });
      const started = Date.now();
      await safely(() => heartbeats.start(opts.job, opts.expectedIntervalSeconds));
      try {
        const result = await opts.handler(request);
        await safely(() => heartbeats.finish(opts.job, true, Date.now() - started, result));
        return Response.json({ ok: true, ...(result && typeof result === "object" ? result : { result }) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[cron] ${opts.job} failed`, message);
        await safely(() => heartbeats.finish(opts.job, false, Date.now() - started, message));
        return Response.json({ ok: false, error: "Job failed" }, { status: 500 });
      }
    });
}
