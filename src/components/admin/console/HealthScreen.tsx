"use client";

// System health — the cron hooks' own heartbeats, the Studio queue and the
// latest failed jobs. Everything is read from stored rows; retrying a job is
// done in the feature that owns it, never from here.

import { useQuery } from "@tanstack/react-query";
import { SurfacePage, GroupLabel, Stat } from "@/components/app/surface/SurfaceLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Cpu } from "@/components/icons";
import type { AdminCronJob, AdminHealth } from "@/lib/admin/types";
import { adminApi } from "./api";
import { LoadError } from "./LoadError";
import { ago, fmtNumber } from "./format";
import { Chip, TableFrame, rowClass, td, th } from "./parts";

const STATE: Record<
  AdminCronJob["state"],
  { label: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  healthy: { label: "Healthy", tone: "success" },
  late: { label: "Late", tone: "warning" },
  failing: { label: "Failing", tone: "danger" },
  never: { label: "Never ran", tone: "neutral" },
};

export function HealthScreen() {
  const health = useQuery({
    queryKey: ["admin", "health"],
    queryFn: () => adminApi<AdminHealth>("/api/admin/health"),
    refetchInterval: 30_000,
  });
  const data = health.data;
  const unhealthy = data ? data.cron.filter((job) => job.state !== "healthy").length : 0;

  return (
    <SurfacePage
      title="System health"
      subtitle={data ? `Updated ${ago(data.generatedAt)}` : "Background jobs and queues"}
    >
      {health.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {health.error && <LoadError error={health.error} onRetry={() => void health.refetch()} />}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Background jobs needing a look"
              value={unhealthy}
              icon={Cpu}
              tone={unhealthy > 0 ? "warning" : "success"}
              hint={`${data.cron.length} tracked`}
            />
            <Stat label="Studio queued" value={fmtNumber(data.studio.queued)} icon={Activity} />
            <Stat label="Studio running" value={fmtNumber(data.studio.running)} />
            <Stat
              label="Failed in 24 hours"
              value={fmtNumber(data.studio.failed24h)}
              tone={data.studio.failed24h > 0 ? "destructive" : "success"}
              hint={data.studio.stuck > 0 ? `${data.studio.stuck} look stuck` : undefined}
            />
          </div>

          <GroupLabel>Scheduled jobs</GroupLabel>
          {data.cron.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No job has reported yet.</p>
          ) : (
            <TableFrame label="Scheduled jobs">
              <thead>
                <tr>
                  <th className={th}>Job</th>
                  <th className={th}>State</th>
                  <th className={th}>Last success</th>
                  <th className={th}>Runs</th>
                  <th className={th}>Last error</th>
                </tr>
              </thead>
              <tbody>
                {data.cron.map((job) => (
                  <tr key={job.job} className={rowClass}>
                    <td className={`${td} font-medium`}>{job.job}</td>
                    <td className={td}>
                      <Chip tone={STATE[job.state].tone}>{STATE[job.state].label}</Chip>
                    </td>
                    <td className={td}>{ago(job.lastSucceededAt)}</td>
                    <td className={td}>
                      {fmtNumber(job.runCount)}
                      {job.failureCount > 0 && (
                        <span className="text-muted-foreground"> · {job.failureCount} failed</span>
                      )}
                    </td>
                    <td className={`${td} max-w-[320px] truncate text-muted-foreground`}>
                      {job.state === "failing" || job.state === "late"
                        ? (job.lastError ?? "—")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}

          <GroupLabel>Latest failed Studio jobs</GroupLabel>
          {data.recentFailures.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No failed jobs.</p>
          ) : (
            <TableFrame label="Failed Studio jobs">
              <thead>
                <tr>
                  <th className={th}>Type</th>
                  <th className={th}>Stage</th>
                  <th className={th}>When</th>
                  <th className={th}>Error</th>
                </tr>
              </thead>
              <tbody>
                {data.recentFailures.map((job) => (
                  <tr key={job.id} className={rowClass}>
                    <td className={`${td} font-medium`}>{job.type}</td>
                    <td className={td}>{job.stage}</td>
                    <td className={td}>{ago(job.updatedAt)}</td>
                    <td className={`${td} max-w-[360px] truncate text-muted-foreground`}>
                      {job.message || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}
        </>
      )}
    </SurfacePage>
  );
}
