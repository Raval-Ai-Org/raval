"use client";

// Usage & cost — AI calls the platform made, from the metering rows the
// gateways write. Costs are the providers' reported cost per call: an estimate,
// not an invoice, and the page says so.

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { SurfacePage, GroupLabel, Stat } from "@/components/app/surface/SurfaceLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Wallet } from "@/components/icons";
import type { AdminUsage, AdminUsageRow } from "@/lib/admin/types";
import { adminApi } from "./api";
import { LoadError } from "./LoadError";
import { ago, fmtNumber, fmtUsd } from "./format";
import { TableFrame, rowClass, td, th } from "./parts";

const RANGES = [1, 7, 30] as const;

function Breakdown<T extends AdminUsageRow>({
  label,
  rows,
  name,
  showErrors = true,
}: {
  label: string;
  rows: T[];
  name: (row: T) => ReactNode;
  showErrors?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No calls in this period.</p>;
  }
  return (
    <TableFrame label={label}>
      <thead>
        <tr>
          <th className={th}>{label}</th>
          <th className={`${th} text-right`}>Calls</th>
          <th className={`${th} text-right`}>Est. cost</th>
          {showErrors && <th className={`${th} text-right`}>Errors</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className={rowClass}>
            <td className={`${td} font-medium`}>{name(row)}</td>
            <td className={`${td} text-right tabular-nums`}>{fmtNumber(row.calls)}</td>
            <td className={`${td} text-right tabular-nums`}>{fmtUsd(row.costUsd)}</td>
            {showErrors && (
              <td className={`${td} text-right tabular-nums`}>{fmtNumber(row.errors ?? 0)}</td>
            )}
          </tr>
        ))}
      </tbody>
    </TableFrame>
  );
}

export function UsageScreen() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const usage = useQuery({
    queryKey: ["admin", "usage", days],
    queryFn: () => adminApi<AdminUsage>(`/api/admin/usage?days=${days}`),
  });
  const data = usage.data;
  const errorRate = data && data.totals.calls > 0 ? data.totals.errors / data.totals.calls : 0;

  return (
    <SurfacePage
      title="Usage & cost"
      subtitle={
        data
          ? `Last ${days} day${days === 1 ? "" : "s"} · updated ${ago(data.generatedAt)} · costs are estimates from provider-reported usage`
          : "AI calls and spend"
      }
      actions={
        <div className="flex gap-1" role="group" aria-label="Period">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setDays(range)}
              aria-pressed={days === range}
              className={`rounded-full px-3 py-1 text-[12.5px] ${
                days === range
                  ? "bg-primary text-primary-foreground"
                  : "bg-foreground/[0.06] text-foreground/75 hover:bg-foreground/10"
              }`}
            >
              {range === 1 ? "24 h" : `${range} d`}
            </button>
          ))}
        </div>
      }
    >
      {usage.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {usage.error && <LoadError error={usage.error} onRetry={() => void usage.refetch()} />}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Estimated spend" value={fmtUsd(data.totals.costUsd)} icon={Wallet} />
            <Stat label="AI calls" value={fmtNumber(data.totals.calls)} icon={Activity} />
            <Stat
              label="Error rate"
              value={`${(errorRate * 100).toFixed(1)}%`}
              tone={errorRate > 0.05 ? "destructive" : errorRate > 0.01 ? "warning" : "success"}
              hint={`${fmtNumber(data.totals.errors)} failed calls`}
            />
            <Stat
              label="Saved by caching"
              value={fmtUsd(data.totals.savedUsd)}
              hint={`${fmtNumber(data.totals.cached)} cached answers`}
            />
          </div>

          <GroupLabel>By kind</GroupLabel>
          <Breakdown label="Kind" rows={data.byKind} name={(r) => r.kind} showErrors={false} />

          <GroupLabel>By model</GroupLabel>
          <Breakdown
            label="Model"
            rows={data.byModel}
            name={(r) => (
              <>
                {r.model}
                <span className="block text-[12px] font-normal text-muted-foreground">
                  {r.provider}
                  {r.avgLatencyMs !== null && ` · ${fmtNumber(r.avgLatencyMs)} ms average`}
                </span>
              </>
            )}
          />

          <GroupLabel>By feature (route)</GroupLabel>
          <Breakdown label="Route" rows={data.byRoute} name={(r) => r.route} />

          <GroupLabel>Biggest workspaces</GroupLabel>
          <Breakdown
            label="Workspace"
            rows={data.topWorkspaces}
            showErrors={false}
            name={(r) => (
              <Link href={`/admin/workspaces/${r.workspaceId}`} className="hover:underline">
                {r.name ?? r.workspaceId}
              </Link>
            )}
          />

          <GroupLabel>By day</GroupLabel>
          <Breakdown label="Day (UTC)" rows={[...data.byDay].reverse()} name={(r) => r.day} />
        </>
      )}
    </SurfacePage>
  );
}
