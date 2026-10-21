"use client";

// Jobs — the background work of Studio, GEO scans, experiments and Autopilot in
// one list. Read-only except for Studio jobs that are still in flight, which can
// be cancelled or nudged: both run the owning feature's own code (the same as a
// customer's cancel button and page poll). Retrying a failed job is not offered
// here, because it spends credits as the customer.

import Link from "next/link";
import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SurfacePage, Stat } from "@/components/app/surface/SurfaceLayout";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import { hasPermission } from "@/lib/admin/permissions";
import type { AdminJobRow, AdminJobs, AdminJobSource } from "@/lib/admin/types";
import { adminApi, errorMessage, query, useAdminMe } from "./api";
import { ConfirmAction } from "./ConfirmAction";
import { LoadError } from "./LoadError";
import { ago, fmtNumber } from "./format";
import { Chip, Pager, TableFrame, rowClass, td, th } from "./parts";

const SOURCES: Array<{ value: "all" | AdminJobSource; label: string }> = [
  { value: "all", label: "All" },
  { value: "studio", label: "Studio" },
  { value: "geo_scan", label: "Scans" },
  { value: "experiment", label: "Experiments" },
  { value: "autopilot", label: "Autopilot" },
];
const STATES = [
  { value: "all", label: "Any state" },
  { value: "active", label: "In flight" },
  { value: "stuck", label: "Stuck" },
  { value: "failed", label: "Failed" },
] as const;
type State = (typeof STATES)[number]["value"];

const SOURCE_LABEL: Record<AdminJobSource, string> = {
  studio: "Studio",
  geo_scan: "Scan",
  experiment: "Experiment",
  autopilot: "Autopilot",
};

const PAGE_SIZE = 25;

function statusTone(job: AdminJobRow): "danger" | "warning" | "success" | "neutral" {
  if (job.status === "failed") return "danger";
  if (job.stuck) return "warning";
  if (["done", "succeeded", "completed", "published", "measured"].includes(job.status)) {
    return "success";
  }
  return "neutral";
}

export function JobsScreen() {
  const queryClient = useQueryClient();
  const me = useAdminMe();
  const [source, setSource] = useState<"all" | AdminJobSource>("all");
  const [state, setState] = useState<State>("all");
  const [page, setPage] = useState(1);
  const canManage = me.data ? hasPermission(me.data.permissions, "jobs.manage") : false;

  const jobs = useQuery({
    queryKey: ["admin", "jobs", { source, state, page }],
    queryFn: () =>
      adminApi<AdminJobs>(`/api/admin/jobs${query({ source, state, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const act = useMutation({
    mutationFn: ({
      action,
      jobId,
      reason,
    }: {
      action: "cancel" | "nudge";
      jobId: string;
      reason: string;
    }) =>
      adminApi<{ status: string }>(`/api/admin/jobs/${action}`, {
        method: "POST",
        body: { jobId, reason },
      }),
    onSuccess: (result, vars) => {
      toast.success(
        vars.action === "cancel" ? "Job cancelled." : `Nudged. The job is now ${result.status}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["admin", "jobs"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const data = jobs.data;

  return (
    <SurfacePage
      title="Jobs"
      subtitle={data ? `Last 30 days · updated ${ago(data.generatedAt)}` : "Background work"}
    >
      {data && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.counts.map((c) => (
            <Stat
              key={c.source}
              label={SOURCE_LABEL[c.source]}
              value={`${fmtNumber(c.active)} in flight`}
              tone={c.stuck > 0 || c.failed24h > 0 ? "warning" : "default"}
              hint={`${fmtNumber(c.stuck)} stuck · ${fmtNumber(c.failed24h)} failed in 24 h`}
              onClick={() => {
                setSource(c.source);
                setPage(1);
              }}
            />
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Source"
          value={source}
          options={SOURCES}
          onValueChange={(next) => {
            setSource(next);
            setPage(1);
          }}
        />
        <SegmentedControl
          label="State"
          value={state}
          options={STATES}
          onValueChange={(next) => {
            setState(next);
            setPage(1);
          }}
        />
      </div>

      {jobs.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {jobs.error && <LoadError error={jobs.error} onRetry={() => void jobs.refetch()} />}
      {data && data.rows.length === 0 && (
        <p className="text-[13px] text-muted-foreground">Nothing matches.</p>
      )}
      {data && data.rows.length > 0 && (
        <>
          <TableFrame label="Jobs">
            <thead>
              <tr>
                <th className={th}>Job</th>
                <th className={th}>Status</th>
                <th className={th}>Tries</th>
                <th className={th}>Updated</th>
                <th className={th}>Error</th>
                <th className={th}>Workspace</th>
                {canManage && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((job) => (
                <tr key={`${job.source}:${job.id}`} className={rowClass}>
                  <td className={td}>
                    <span className="font-medium">{job.kind}</span>
                    <span className="block text-[12px] text-muted-foreground">
                      {SOURCE_LABEL[job.source]}
                    </span>
                  </td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1.5">
                      <Chip tone={statusTone(job)}>{job.status}</Chip>
                      {job.stuck && <Chip tone="warning">Stuck</Chip>}
                    </div>
                  </td>
                  <td className={`${td} tabular-nums`}>
                    {job.attempts ?? "—"}
                    {job.maxAttempts ? ` / ${job.maxAttempts}` : ""}
                  </td>
                  <td className={td}>{ago(job.updatedAt)}</td>
                  <td className={`${td} max-w-[260px] truncate text-muted-foreground`}>
                    {job.error || "—"}
                  </td>
                  <td className={td}>
                    <Link
                      href={`/admin/workspaces/${job.workspaceId}`}
                      className="text-primary hover:underline"
                    >
                      Open
                    </Link>
                  </td>
                  {canManage && (
                    <td className={`${td} min-w-[150px]`}>
                      {job.canAct && (
                        <div className="flex flex-col items-end gap-2">
                          {job.status === "running" && (
                            <ConfirmAction
                              label="Nudge"
                              description="Takes one step on this job, like a customer's page refresh. It adds no new work."
                              onConfirm={(reason) =>
                                act
                                  .mutateAsync({ action: "nudge", jobId: job.id, reason })
                                  .then(() => undefined)
                              }
                            />
                          )}
                          <ConfirmAction
                            label="Cancel"
                            tone="danger"
                            confirmLabel="Cancel job"
                            description="Stops the job and releases the customer's credit hold, as their own cancel button would."
                            onConfirm={(reason) =>
                              act
                                .mutateAsync({ action: "cancel", jobId: job.id, reason })
                                .then(() => undefined)
                            }
                          />
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableFrame>
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />
        </>
      )}
    </SurfacePage>
  );
}
