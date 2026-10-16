"use client";

// One workspace, read-only: owner, members, plan, recent studio activity and
// what the admin team did to it. Suspension and read-only mode arrive with the
// phase that adds the matching check to the shared request path.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { SurfacePage, GroupLabel, Tile } from "@/components/app/surface/SurfaceLayout";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "@/components/icons";
import type { AdminWorkspaceDetail } from "@/lib/admin/types";
import { adminApi } from "./api";
import { AuditList } from "./AuditList";
import { fmtDate } from "./format";
import { Chip, Fact } from "./parts";

export function WorkspaceDetailScreen({ id }: { id: string }) {
  const detail = useQuery({
    queryKey: ["admin", "workspaces", "detail", id],
    queryFn: () => adminApi<AdminWorkspaceDetail>(`/api/admin/workspaces/detail?id=${id}`),
  });

  if (detail.isLoading) {
    return (
      <SurfacePage>
        <Skeleton className="h-64 rounded-2xl" />
      </SurfacePage>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <SurfacePage>
        <ErrorState
          description={detail.error?.message ?? "Could not load this workspace."}
          onRetry={() => void detail.refetch()}
        />
      </SurfacePage>
    );
  }

  const { workspace, members, billing, studioJobs7d, audit } = detail.data;
  const jobTotal = Object.values(studioJobs7d).reduce((sum, value) => sum + value, 0);

  return (
    <SurfacePage
      title={workspace.name}
      subtitle={workspace.domain ?? undefined}
      actions={
        <Link
          href="/admin/workspaces"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All workspaces
        </Link>
      }
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip
          tone={workspace.billingPlan && workspace.billingPlan !== "free" ? "primary" : "neutral"}
        >
          {workspace.billingPlan ?? workspace.plan ?? "free"}
        </Chip>
        {workspace.frozen && <Chip tone="warning">Frozen</Chip>}
      </div>

      <Tile>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Workspace id">
            <span className="font-mono text-[12.5px]">{workspace.id}</span>
          </Fact>
          <Fact label="Owner">
            <Link href={`/admin/users/${workspace.ownerId}`} className="hover:underline">
              {workspace.ownerEmail ?? workspace.ownerId}
            </Link>
          </Fact>
          <Fact label="Created">{fmtDate(workspace.createdAt)}</Fact>
          <Fact label="Website">{workspace.websiteUrl ?? "—"}</Fact>
          <Fact label="Industry">{workspace.industry ?? "—"}</Fact>
          <Fact label="Onboarded">
            {workspace.onboardedAt ? fmtDate(workspace.onboardedAt) : "Not yet"}
          </Fact>
          {workspace.frozen && <Fact label="Frozen because">{workspace.frozenReason ?? "—"}</Fact>}
        </dl>
      </Tile>

      <GroupLabel>Billing account</GroupLabel>
      {billing ? (
        <Tile className="space-y-1">
          <p className="text-[14px] font-medium capitalize">
            {billing.planId} · {billing.status.replace("_", " ")}
            {billing.comped && " · comped"}
          </p>
          <p className="text-[12.5px] text-muted-foreground">
            {billing.trialEndsAt ? `Trial ends ${fmtDate(billing.trialEndsAt)} · ` : ""}
            {billing.currentPeriodEnd
              ? `Renews ${fmtDate(billing.currentPeriodEnd)}`
              : "No billing period"}
          </p>
        </Tile>
      ) : (
        <p className="text-[13px] text-muted-foreground">No billing account is linked.</p>
      )}

      <GroupLabel>Studio jobs · last 7 days</GroupLabel>
      {jobTotal === 0 ? (
        <p className="text-[13px] text-muted-foreground">No jobs in the last 7 days.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {Object.entries(studioJobs7d).map(([status, count]) => (
            <Chip
              key={status}
              tone={status === "failed" ? "danger" : status === "succeeded" ? "success" : "neutral"}
            >
              {status} · {count}
            </Chip>
          ))}
        </div>
      )}

      <GroupLabel>Members ({members.length})</GroupLabel>
      <Tile className="p-0">
        <ul>
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center justify-between gap-3 border-t border-border/50 px-4 py-3 first:border-t-0"
            >
              <Link
                href={`/admin/users/${member.userId}`}
                className="min-w-0 truncate text-[13.5px] hover:underline"
              >
                {member.email ?? member.userId}
              </Link>
              <span className="shrink-0 text-[12.5px] text-muted-foreground">
                {member.role} · joined {fmtDate(member.joinedAt)}
              </span>
            </li>
          ))}
        </ul>
      </Tile>

      {audit.length > 0 && (
        <>
          <GroupLabel>History</GroupLabel>
          <AuditList rows={audit} compact />
        </>
      )}
    </SurfacePage>
  );
}
