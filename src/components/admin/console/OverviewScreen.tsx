"use client";

// Overview — real platform numbers only. Every figure comes from stored rows
// (admin_overview); a section the admin may not read simply does not appear.

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { SurfacePage, GroupLabel, Stat } from "@/components/app/surface/SurfaceLayout";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Building2, Inbox, ShieldCheck, Users, Wallet } from "@/components/icons";
import type { AdminOverview } from "@/lib/admin/types";
import { adminApi, useAdminMe } from "./api";
import { ago, fmtNumber } from "./format";

export function OverviewScreen() {
  const me = useAdminMe();
  const router = useRouter();
  const overview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => adminApi<AdminOverview>("/api/admin/overview"),
    refetchInterval: 60_000,
  });
  const data = overview.data;

  return (
    <SurfacePage
      title="Overview"
      subtitle={
        data ? `Updated ${ago(data.generatedAt)} · figures are counts of stored records` : undefined
      }
    >
      {overview.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      )}
      {overview.error && (
        <ErrorState description={overview.error.message} onRetry={() => void overview.refetch()} />
      )}
      {data && (
        <>
          <GroupLabel>People</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              label="Users"
              value={fmtNumber(data.users.total)}
              icon={Users}
              hint={`${fmtNumber(data.users.new7d)} new this week`}
            />
            <Stat
              label="Signed in this week"
              value={fmtNumber(data.users.active7d)}
              icon={Activity}
              hint={`${fmtNumber(data.users.new30d)} new in 30 days`}
            />
            <Stat
              label="Suspended"
              value={fmtNumber(data.users.suspended)}
              icon={ShieldCheck}
              tone={data.users.suspended > 0 ? "warning" : "default"}
              hint={`${fmtNumber(data.users.unconfirmed)} unconfirmed emails`}
            />
          </div>

          <GroupLabel>Workspaces & billing</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              label="Workspaces"
              value={fmtNumber(data.workspaces.total)}
              icon={Building2}
              hint={`${fmtNumber(data.workspaces.new7d)} new this week`}
            />
            <Stat
              label="Paying accounts"
              value={fmtNumber(data.billing.payingAccounts)}
              icon={Wallet}
              hint={`${fmtNumber(data.billing.trialingAccounts)} on trial`}
            />
            <Stat
              label="Upgrade requests waiting"
              value={fmtNumber(data.billing.pendingRequests)}
              icon={Inbox}
              tone={data.billing.pendingRequests > 0 ? "primary" : "default"}
              hint={me.data?.billing ? "Open the billing console" : undefined}
              onClick={me.data?.billing ? () => router.push("/admin/billing") : undefined}
            />
            {data.workspaces.frozen > 0 && (
              <Stat
                label="Frozen workspaces"
                value={fmtNumber(data.workspaces.frozen)}
                tone="warning"
                hint="Over their plan's limits"
              />
            )}
          </div>

          <GroupLabel>Studio jobs</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              label="Failed in 24 hours"
              value={fmtNumber(data.jobs.studioFailed24h)}
              tone={data.jobs.studioFailed24h > 0 ? "destructive" : "success"}
            />
            <Stat label="Queued or running" value={fmtNumber(data.jobs.studioRunning)} />
          </div>
        </>
      )}
    </SurfacePage>
  );
}
