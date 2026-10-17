"use client";

// Analytics — signups, activity, the first-steps funnel and feature adoption,
// all counted from stored rows. Each figure says what it counts: the platform
// keeps no page-view history, so "active" means "used an AI feature" or
// "signed in", never a guess.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SurfacePage, GroupLabel, Stat, Tile } from "@/components/app/surface/SurfaceLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Users } from "@/components/icons";
import type { AdminAnalytics } from "@/lib/admin/types";
import { adminApi } from "./api";
import { LoadError } from "./LoadError";
import { ago, fmtNumber } from "./format";
import { TableFrame, rowClass, td, th } from "./parts";

const RANGES = [7, 30, 90] as const;

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

export function AnalyticsScreen() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const analytics = useQuery({
    queryKey: ["admin", "analytics", days],
    queryFn: () => adminApi<AdminAnalytics>(`/api/admin/analytics?days=${days}`),
  });
  const data = analytics.data;
  const peak = data ? Math.max(1, ...data.signupsByDay.map((d) => d.signups)) : 1;

  return (
    <SurfacePage
      title="Analytics"
      subtitle={
        data
          ? `Last ${days} days · updated ${ago(data.generatedAt)}`
          : "Signups, activity and adoption"
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
              {range} d
            </button>
          ))}
        </div>
      }
    >
      {analytics.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {analytics.error && (
        <LoadError error={analytics.error} onRetry={() => void analytics.refetch()} />
      )}
      {data && (
        <>
          <GroupLabel>Used an AI feature</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Today" value={fmtNumber(data.aiActive.day)} icon={Users} />
            <Stat label="This week" value={fmtNumber(data.aiActive.week)} />
            <Stat label="This month" value={fmtNumber(data.aiActive.month)} />
          </div>

          <GroupLabel>Signed in</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Last 24 hours" value={fmtNumber(data.signedIn.day)} />
            <Stat label="Last 7 days" value={fmtNumber(data.signedIn.week)} />
            <Stat label="Last 30 days" value={fmtNumber(data.signedIn.month)} />
          </div>

          <GroupLabel>First steps of people who signed up in this period</GroupLabel>
          <TableFrame label="Funnel">
            <thead>
              <tr>
                <th className={th}>Step</th>
                <th className={`${th} text-right`}>People</th>
                <th className={`${th} text-right`}>Of those who signed up</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Signed up", data.funnel.signedUp],
                  ["Joined or created a workspace", data.funnel.hasWorkspace],
                  ["Used an AI feature", data.funnel.usedAi],
                  ["On a paid plan", data.funnel.paying],
                ] as const
              ).map(([label, value]) => (
                <tr key={label} className={rowClass}>
                  <td className={`${td} font-medium`}>{label}</td>
                  <td className={`${td} text-right tabular-nums`}>{fmtNumber(value)}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {pct(value, data.funnel.signedUp)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>

          <GroupLabel>Signups per day</GroupLabel>
          {data.signupsByDay.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No signups in this period.</p>
          ) : (
            <Tile className="p-4">
              <ul className="space-y-1.5" aria-label="Signups per day">
                {data.signupsByDay.map((row) => (
                  <li key={row.day} className="flex items-center gap-3 text-[12.5px]">
                    <span className="w-24 shrink-0 text-muted-foreground">{row.day}</span>
                    <span
                      className="h-2.5 rounded-full bg-primary"
                      style={{ width: `${Math.max(2, (row.signups / peak) * 100)}%` }}
                    />
                    <span className="tabular-nums">{row.signups}</span>
                  </li>
                ))}
              </ul>
            </Tile>
          )}

          <GroupLabel>Feature use (workspaces with at least one call)</GroupLabel>
          {data.adoption.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No AI use in this period.</p>
          ) : (
            <TableFrame label="Adoption">
              <thead>
                <tr>
                  <th className={th}>Kind</th>
                  <th className={`${th} text-right`}>Workspaces</th>
                  <th className={`${th} text-right`}>People</th>
                </tr>
              </thead>
              <tbody>
                {data.adoption.map((row) => (
                  <tr key={row.kind} className={rowClass}>
                    <td className={`${td} font-medium`}>{row.kind}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmtNumber(row.workspaces)}</td>
                    <td className={`${td} text-right tabular-nums`}>{fmtNumber(row.users)}</td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}

          <GroupLabel>Accounts by plan</GroupLabel>
          <TableFrame label="Plans">
            <thead>
              <tr>
                <th className={th}>Plan</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Accounts</th>
              </tr>
            </thead>
            <tbody>
              {data.plans.map((row) => (
                <tr key={`${row.planId}:${row.status}`} className={rowClass}>
                  <td className={`${td} font-medium`}>{row.planId}</td>
                  <td className={td}>{row.status}</td>
                  <td className={`${td} text-right tabular-nums`}>{fmtNumber(row.accounts)}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </>
      )}
    </SurfacePage>
  );
}
