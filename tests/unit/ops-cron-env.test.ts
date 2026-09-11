// Operability kernel: boot-time env validation, the shared cron route (secret
// check + heartbeats) and the ops-watch checks behind alerting.
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkEnv } from "@/server/env";
import { cronSecretError, defineCronRoute, setHeartbeatSink } from "@/server/cron";
import { missedHeartbeats, runOpsWatch, spendAnomaly } from "@/server/observability/ops-watch";

const SECRET = "cron-secret-for-tests-0123456789";

const PROD_OK = {
  NODE_ENV: "production",
  APP_URL: "https://app.example.com",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxx",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-xxxxxxxxxxxxxxxx",
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxxxxxxx",
  OPENROUTER_API_KEY: "sk-or-v1-test",
  CRON_SECRET: SECRET,
};

afterEach(() => {
  vi.unstubAllEnvs();
  setHeartbeatSink(null);
});

describe("checkEnv", () => {
  it("accepts a complete production config", () => {
    expect(checkEnv(PROD_OK).ok).toBe(true);
  });

  it("fails production when a required variable is missing", () => {
    const { ok, errors } = checkEnv({ ...PROD_OK, CRON_SECRET: undefined });
    expect(ok).toBe(false);
    expect(errors).toContain("CRON_SECRET is not set");
  });

  it("only warns in development", () => {
    const report = checkEnv({ NODE_ENV: "development" });
    expect(report.ok).toBe(true);
    expect(report.warnings.some((w) => w.startsWith("APP_URL"))).toBe(true);
  });

  it("never echoes a variable's value in its message", () => {
    const { errors } = checkEnv({ ...PROD_OK, OPENROUTER_API_KEY: "leaky-value-123" });
    expect(errors.some((e) => e.startsWith("OPENROUTER_API_KEY"))).toBe(true);
    expect(errors.join(" ")).not.toContain("leaky-value-123");
  });

  it("requires the SDR variables only when distribution is on", () => {
    expect(checkEnv(PROD_OK).errors.some((e) => e.startsWith("SDR_"))).toBe(false);
    const on = checkEnv({ ...PROD_OK, FEATURE_FLAG_SDR_ENABLED: "true" });
    expect(on.errors).toContain("SDR_ADMIN_TOKEN is required when FEATURE_FLAG_SDR_ENABLED is on");
  });

  it("refuses a localhost APP_URL in production", () => {
    const { errors } = checkEnv({ ...PROD_OK, APP_URL: "http://localhost:8080" });
    expect(errors).toContain("APP_URL points at localhost in production");
  });
});

describe("cron route kernel", () => {
  const req = (secret?: string) =>
    new Request("http://localhost/api/public/hooks/x", {
      method: "POST",
      headers: secret ? { "x-cron-secret": secret } : {},
    });

  it("returns 503 when CRON_SECRET is unset or too short", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(cronSecretError(req(SECRET))?.status).toBe(503);
    vi.stubEnv("CRON_SECRET", "short");
    expect(cronSecretError(req("short"))?.status).toBe(503);
  });

  it("returns 401 on a missing or wrong secret", () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect(cronSecretError(req())?.status).toBe(401);
    expect(cronSecretError(req(SECRET + "x"))?.status).toBe(401);
    expect(cronSecretError(req(SECRET))).toBeNull();
  });

  it("records a start and a success heartbeat around the handler", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const calls: string[] = [];
    setHeartbeatSink({
      start: async (job, interval) => void calls.push(`start:${job}:${interval}`),
      finish: async (job, ok) => void calls.push(`finish:${job}:${ok}`),
    });
    const handler = vi.fn(async () => ({ ran: 2 }));
    const res = await defineCronRoute({ job: "test-job", expectedIntervalSeconds: 60, handler })(req(SECRET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ran: 2 });
    expect(calls).toEqual(["start:test-job:60", "finish:test-job:true"]);
  });

  it("does not run the handler without the secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const handler = vi.fn(async () => ({}));
    const res = await defineCronRoute({ job: "j", expectedIntervalSeconds: 60, handler })(req("nope"));
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("records a failure heartbeat and hides the error text from the caller", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const finishes: Array<[boolean, unknown]> = [];
    setHeartbeatSink({
      start: async () => {},
      finish: async (_job, ok, _ms, detail) => void finishes.push([ok, detail]),
    });
    const res = await defineCronRoute({
      job: "boom",
      expectedIntervalSeconds: 60,
      handler: async () => {
        throw new Error("db password wrong");
      },
    })(req(SECRET));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("password");
    expect(finishes).toEqual([[false, "db password wrong"]]);
  });

  it("still runs the job when the heartbeat store is down", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
    setHeartbeatSink({
      start: async () => {
        throw new Error("heartbeat table missing");
      },
      finish: async () => {
        throw new Error("heartbeat table missing");
      },
    });
    const res = await defineCronRoute({ job: "j", expectedIntervalSeconds: 60, handler: async () => ({ ok: 1 }) })(
      req(SECRET),
    );
    expect(res.status).toBe(200);
  });
});

describe("ops-watch", () => {
  const NOW = Date.parse("2026-09-12T12:00:00Z");

  it("flags a job with no success within 3x its interval", () => {
    const rows = [
      { job: "fresh", expected_interval_seconds: 60, last_succeeded_at: new Date(NOW - 120_000).toISOString(), last_started_at: null, last_error: null },
      { job: "stale", expected_interval_seconds: 60, last_succeeded_at: new Date(NOW - 200_000).toISOString(), last_started_at: null, last_error: null },
      { job: "never", expected_interval_seconds: 300, last_succeeded_at: null, last_started_at: null, last_error: null },
    ];
    expect(missedHeartbeats(rows, NOW).map((r) => r.job)).toEqual(["stale", "never"]);
  });

  it("detects spend anomalies only above the absolute floor", () => {
    expect(spendAnomaly(30, [5, 6, 4]).anomalous).toBe(true);
    expect(spendAnomaly(4, [0.5, 0.5]).anomalous).toBe(false); // under the $5 floor
    expect(spendAnomaly(12, [5, 5]).anomalous).toBe(false); // under 3x
  });

  function fakeDb(tables: Record<string, unknown[]>) {
    return {
      from(table: string) {
        const result = { data: tables[table] ?? [], error: null };
        const q: Record<string, unknown> = {};
        for (const m of ["select", "gte", "like", "in", "limit", "eq"]) q[m] = () => q;
        q.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
        return q;
      },
      rpc: async () => ({ data: { pruned: 3 }, error: null }),
    };
  }

  it("alerts on missed jobs, spend spikes, truncation and webhook rejections", async () => {
    const today = "2026-09-12";
    const db = fakeDb({
      cron_heartbeats: [
        { job: "run-schedules", expected_interval_seconds: 60, last_succeeded_at: null, last_started_at: null, last_error: "boom" },
        { job: "ops-watch", expected_interval_seconds: 300, last_succeeded_at: null, last_started_at: null, last_error: null },
      ],
      ai_usage_daily: [
        { day: today, cost_usd: 40, truncated_calls: 20, calls: 100, scope_key: "ws:a" },
        { day: "2026-09-11", cost_usd: 5, truncated_calls: 0, calls: 90, scope_key: "ws:a" },
        { day: "2026-09-10", cost_usd: 6, truncated_calls: 0, calls: 90, scope_key: "ws:a" },
      ],
      sdr_webhook_events: Array.from({ length: 25 }, (_, i) => ({ id: i })),
    });
    const sent: Array<{ key: string; severity: string }> = [];
    const result = await runOpsWatch({
      db,
      now: () => NOW,
      alert: async (a) => {
        sent.push({ key: a.key, severity: a.severity });
        return true;
      },
    });
    expect(result.alerts).toEqual(["missed:run-schedules", "spend", "truncation", "webhooks"]);
    // ops-watch never alerts on itself; the publishing scheduler is critical.
    expect(sent.find((s) => s.key === "missed:run-schedules")?.severity).toBe("critical");
    expect(sent.some((s) => s.key.includes("ops-watch"))).toBe(false);
    expect(result.pruned).toEqual({ pruned: 3 });
  });

  it("stays quiet on a healthy day", async () => {
    const db = fakeDb({
      cron_heartbeats: [
        { job: "run-schedules", expected_interval_seconds: 60, last_succeeded_at: new Date(NOW - 30_000).toISOString(), last_started_at: null, last_error: null },
      ],
      ai_usage_daily: [{ day: "2026-09-12", cost_usd: 2, truncated_calls: 1, calls: 100, scope_key: "ws:a" }],
      sdr_webhook_events: [],
    });
    const alert = vi.fn(async () => true);
    const result = await runOpsWatch({ db, now: () => NOW, alert });
    expect(result.alerts).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
  });
});
