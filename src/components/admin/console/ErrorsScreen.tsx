"use client";

// Errors — what went wrong for whom in the last 7 days: failed Studio pieces
// and AI calls that errored, each with what the person was trying to do and
// where. Grouped by person first, then the full list with a filter.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SurfacePage } from "@/components/app/surface/SurfaceLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Bot, CheckCircle2, Sparkles, Users } from "@/components/icons";
import { hasPermission } from "@/lib/admin/permissions";
import type { AdminPulseError } from "@/lib/admin/types";
import { useAdminMe } from "./api";
import { LoadError } from "./LoadError";
import { ago, fmtDateTime } from "./format";
import {
  Avatar,
  BarRow,
  Card,
  CountUp,
  Kpi,
  Pills,
  personName,
  shortDay,
  usePulse,
} from "./pulse-ui";

function ErrorRow({ error, onOpen }: { error: AdminPulseError; onOpen?: () => void }) {
  const Icon = error.source === "studio" ? Sparkles : Bot;
  return (
    <li className="border-b border-border/40 last:border-0">
      <button
        type="button"
        disabled={!onOpen}
        onClick={onOpen}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left hover:bg-foreground/[0.03] disabled:hover:bg-transparent"
      >
        <span className="mt-0.5 grid size-8 place-items-center rounded-xl bg-destructive/10 text-destructive">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px]">
            <span className="font-semibold">{personName(error)}</span>
            <span className="text-muted-foreground"> was </span>
            <span className="font-medium">{error.what.toLowerCase()}</span>
          </span>
          <span className="mt-0.5 block break-words text-[12px] text-destructive">
            {error.message}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {[error.workspaceName, error.detail].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground" title={fmtDateTime(error.at)}>
          {ago(error.at)}
        </span>
      </button>
    </li>
  );
}

export function ErrorsScreen() {
  const me = useAdminMe();
  const router = useRouter();
  const pulse = usePulse();
  const [what, setWhat] = useState("all");
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const data = pulse.data;
  const canOpen = me.data ? hasPermission(me.data.permissions, "users.read") : false;

  const byPerson = useMemo(() => {
    const groups = new Map<string, AdminPulseError[]>();
    for (const error of data?.errors ?? []) {
      const key = error.userId ?? "system";
      groups.set(key, [...(groups.get(key) ?? []), error]);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [data]);

  const list = useMemo(
    () => (data?.errors ?? []).filter((e) => what === "all" || e.what === what),
    [data, what],
  );

  return (
    <SurfacePage title="Errors" subtitle="What failed for whom, last 7 days">
      {pulse.error && <LoadError error={pulse.error} onRetry={() => void pulse.refetch()} />}
      {pulse.isLoading && (
        <div className="grid gap-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Last 24 hours"
              value={<CountUp value={data.totals.errors24h} />}
              icon={AlertTriangle}
              color={data.totals.errors24h ? "#e5484d" : "#94a3b8"}
            />
            <Kpi
              label="Last 7 days"
              value={<CountUp value={data.totals.errors7d} />}
              icon={AlertTriangle}
              color="#f5a524"
            />
            <Kpi
              label="People affected"
              value={<CountUp value={byPerson.filter(([id]) => id !== "system").length} />}
              icon={Users}
              color="#7c6cf2"
            />
            <Kpi
              label="Fails most"
              value={
                <span className="text-[18px]">{data.errorsByWhat[0]?.label ?? "Nothing"}</span>
              }
              hint={data.errorsByWhat[0] ? `${data.errorsByWhat[0].count} times` : undefined}
              icon={Sparkles}
              color="#e86fb1"
            />
          </div>

          {data.errors.length === 0 ? (
            <Card className="mt-3">
              <div className="grid place-items-center gap-2 py-10 text-center">
                <span className="grid size-12 place-items-center rounded-full bg-success/12 text-success">
                  <CheckCircle2 className="size-6" />
                </span>
                <p className="text-[14px] font-semibold">No errors this week</p>
              </div>
            </Card>
          ) : (
            <>
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                <Card title="Errors each day" icon={AlertTriangle} className="lg:col-span-2">
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={data.days.map((d) => ({ ...d, label: shortDay(d.day) }))}
                        margin={{ top: 8, right: 4, bottom: 0, left: -24 }}
                      >
                        <CartesianGrid
                          vertical={false}
                          strokeDasharray="3 6"
                          className="stroke-border"
                        />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                          tick={{ fontSize: 11, fill: "currentColor" }}
                          className="text-muted-foreground"
                        />
                        <YAxis
                          allowDecimals={false}
                          tickLine={false}
                          axisLine={false}
                          width={44}
                          tick={{ fontSize: 11, fill: "currentColor" }}
                          className="text-muted-foreground"
                        />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--foreground) / 0.04)" }}
                          contentStyle={{ borderRadius: 12, fontSize: 12 }}
                          formatter={(value: number) => [value, "Errors"]}
                        />
                        <Bar dataKey="errors" fill="#e5484d" radius={[8, 8, 3, 3]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
                <Card title="What failed" icon={Sparkles}>
                  <div className="grid gap-1">
                    {data.errorsByWhat.map((row) => (
                      <BarRow
                        key={row.label}
                        label={row.label}
                        value={row.count}
                        max={data.errorsByWhat[0].count}
                        color="#e5484d"
                        onClick={() => setWhat(what === row.label ? "all" : row.label)}
                      />
                    ))}
                  </div>
                </Card>
              </div>

              <h4 className="ds-label mb-2.5 mt-7">By person</h4>
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {byPerson.slice(0, 12).map(([id, errors]) => {
                  const first = errors[0];
                  const expanded = openPerson === id;
                  return (
                    <Card key={id} className="p-3.5 sm:p-4">
                      <button
                        type="button"
                        onClick={() => setOpenPerson(expanded ? null : id)}
                        className="flex w-full items-center gap-3 text-left"
                      >
                        <Avatar name={personName(first)} id={id} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold">
                            {id === "system" ? "No person (background)" : personName(first)}
                          </span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">
                            Last: {first.what.toLowerCase()} · {ago(first.at)}
                          </span>
                        </span>
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-destructive/10 text-[13px] font-semibold text-destructive tabular-nums">
                          {errors.length}
                        </span>
                      </button>
                      <p className="mt-2 line-clamp-2 text-[12px] text-destructive">
                        {first.message}
                      </p>
                      {expanded && (
                        <ul className="mt-2 grid gap-1.5 border-t border-border/50 pt-2">
                          {errors.slice(0, 8).map((e) => (
                            <li key={e.id} className="text-[11.5px]">
                              <span className="font-medium">{e.what}</span>
                              <span className="text-muted-foreground"> · {ago(e.at)}</span>
                              <span className="block truncate text-muted-foreground">
                                {e.message}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {canOpen && id !== "system" && (
                        <button
                          type="button"
                          onClick={() => router.push(`/admin/users/${id}`)}
                          className="mt-2 text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
                        >
                          Open person ›
                        </button>
                      )}
                    </Card>
                  );
                })}
              </div>

              <div className="mb-2.5 mt-7 flex flex-wrap items-center justify-between gap-2">
                <h4 className="ds-label">Every error</h4>
              </div>
              <Pills
                value={what}
                onChange={setWhat}
                items={[
                  { id: "all", label: "All", count: data.errors.length },
                  ...data.errorsByWhat.map((row) => ({
                    id: row.label,
                    label: row.label,
                    count: row.count,
                  })),
                ]}
              />
              <Card className="mt-2 p-0 sm:p-0">
                <ul>
                  {list.slice(0, 100).map((error) => (
                    <ErrorRow
                      key={error.id}
                      error={error}
                      onOpen={
                        canOpen && error.userId
                          ? () => router.push(`/admin/users/${error.userId}`)
                          : undefined
                      }
                    />
                  ))}
                </ul>
              </Card>
            </>
          )}
        </>
      )}
    </SurfacePage>
  );
}
