// System health for the admin console: the cron hooks' own heartbeats, the
// Studio queue, and the latest failed jobs. Read-only; retrying or cancelling a
// job belongs to the feature that owns it.
import "server-only";
import type { AdminCronJob, AdminHealth } from "@/lib/admin/types";
import { adminRpc } from "./db.server";

type RawCron = {
  job: string;
  expected_interval_seconds: number;
  last_started_at: string | null;
  last_succeeded_at: string | null;
  last_failed_at: string | null;
  failure_count: number;
  run_count: number;
  last_duration_ms: number | null;
  last_error: string | null;
};

type Raw = {
  generated_at: string;
  cron: RawCron[];
  studio: { queued: number; running: number; failed_24h: number; stuck: number };
  recent_failures: Array<{
    id: string;
    type: string;
    stage: string;
    workspace_id: string;
    updated_at: string;
    message: string;
  }>;
};

/** A hook is "late" when it has not succeeded for two of its own intervals. */
export function cronState(row: RawCron, now = Date.now()): AdminCronJob["state"] {
  const ok = row.last_succeeded_at ? Date.parse(row.last_succeeded_at) : null;
  const failed = row.last_failed_at ? Date.parse(row.last_failed_at) : null;
  if (ok === null && failed === null) return "never";
  if (failed !== null && (ok === null || failed > ok)) return "failing";
  const allowed = Math.max(row.expected_interval_seconds, 60) * 2 * 1000;
  return ok !== null && now - ok > allowed ? "late" : "healthy";
}

const n = (value: unknown) => Number(value ?? 0);

export async function getHealth(): Promise<AdminHealth> {
  const raw = await adminRpc<Raw>("admin_health", {}, "System health is unavailable.");
  return {
    generatedAt: raw.generated_at,
    cron: (raw.cron ?? []).map((row) => ({
      job: row.job,
      expectedIntervalSeconds: n(row.expected_interval_seconds),
      lastStartedAt: row.last_started_at,
      lastSucceededAt: row.last_succeeded_at,
      lastFailedAt: row.last_failed_at,
      failureCount: n(row.failure_count),
      runCount: n(row.run_count),
      lastDurationMs: row.last_duration_ms === null ? null : n(row.last_duration_ms),
      lastError: row.last_error,
      state: cronState(row),
    })),
    studio: {
      queued: n(raw.studio.queued),
      running: n(raw.studio.running),
      failed24h: n(raw.studio.failed_24h),
      stuck: n(raw.studio.stuck),
    },
    recentFailures: (raw.recent_failures ?? []).map((row) => ({
      id: row.id,
      type: row.type,
      stage: row.stage,
      workspaceId: row.workspace_id,
      updatedAt: row.updated_at,
      message: row.message,
    })),
  };
}
