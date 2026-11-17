"use client";

// Activity — who is in Mellox, for how long, doing what, and which workspaces
// were created. Time is estimated from the times of each person's actions
// (AI calls and Studio pieces), never from a timer in the browser.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SurfacePage } from "@/components/app/surface/SurfaceLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Building2, Clock, Sparkles, Users } from "@/components/icons";
import { hasPermission } from "@/lib/admin/permissions";
import { useAdminMe } from "./api";
import { LoadError } from "./LoadError";
import { ago, fmtDateTime } from "./format";
import {
  Avatar,
  BarRow,
  Card,
  CountUp,
  Kpi,
  PlanPill,
  Pills,
  minutes,
  personName,
  shortDay,
  usePulse,
} from "./pulse-ui";

type Range = "7d" | "14d";

export function ActivityScreen() {
  const me = useAdminMe();
  const router = useRouter();
  const pulse = usePulse();
  const [range, setRange] = useState<Range>("7d");
  const [showAll, setShowAll] = useState(false);
  const data = pulse.data;
  const canOpen = me.data ? hasPermission(me.data.permissions, "users.read") : false;
  const open = (id: string) => canOpen && router.push(`/admin/users/${id}`);

  const people = useMemo(() => {
    const key = range === "7d" ? "activeMinutes7d" : "activeMinutes14d";
    return (data?.customers ?? [])
      .filter((c) => c[key] > 0)
      .map((c) => ({ ...c, mins: c[key] }))
      .sort((a, b) => b.mins - a.mins);
  }, [data, range]);

  const recent = useMemo(
    () =>
      (data?.customers ?? [])
        .filter((c) => c.lastActiveAt)
        .sort((a, b) => Date.parse(b.lastActiveAt!) - Date.parse(a.lastActiveAt!))
        .slice(0, 12),
    [data],
  );

  const doing = useMemo(() => {
    const totals = new Map<string, number>();
    for (const c of data?.customers ?? []) {
      for (const a of c.topActivities) totals.set(a.label, (totals.get(a.label) ?? 0) + a.count);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [data]);

  const activeWeek = data?.totals.activeUsers7d ?? 0;
  const shownPeople = showAll ? people : people.slice(0, 12);

  return (
    <SurfacePage title="Activity" subtitle="Who uses Mellox, for how long, doing what">
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
              label="Here today"
              value={<CountUp value={data.totals.activeToday} />}
              icon={Activity}
              color="#1fd6c4"
            />
            <Kpi
              label="Here this week"
              value={<CountUp value={activeWeek} />}
              icon={Users}
              color="#7c6cf2"
            />
            <Kpi
              label="Time this week"
              value={minutes(data.totals.minutes7d)}
              icon={Clock}
              color="#4f8ef7"
            />
            <Kpi
              label="Average per person"
              value={minutes(activeWeek ? Math.round(data.totals.minutes7d / activeWeek) : 0)}
              hint={`${data.totals.pieces7d} pieces made`}
              icon={Sparkles}
              color="#3fbf5a"
            />
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <Card title="People here each day" icon={Users} className="lg:col-span-2">
              <div className="h-[220px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.days.map((d) => ({ ...d, label: shortDay(d.day) }))}
                    margin={{ top: 8, right: 4, bottom: 0, left: -24 }}
                  >
                    <defs>
                      <linearGradient id="active-bars" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1fd6c4" />
                        <stop offset="100%" stopColor="#3fe46e" stopOpacity={0.7} />
                      </linearGradient>
                    </defs>
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
                      formatter={(value: number) => [value, "People"]}
                    />
                    <Bar dataKey="activeUsers" fill="url(#active-bars)" radius={[8, 8, 3, 3]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="What people do most" icon={Sparkles}>
              {doing.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">Nothing yet.</p>
              ) : (
                <div className="grid gap-1">
                  {doing.map(([label, count], index) => (
                    <BarRow
                      key={label}
                      label={label}
                      value={count}
                      max={doing[0][1]}
                      color={
                        [
                          "#7c6cf2",
                          "#1fd6c4",
                          "#3fbf5a",
                          "#f5a524",
                          "#4f8ef7",
                          "#e86fb1",
                          "#94a3b8",
                          "#9cf03f",
                        ][index]
                      }
                    />
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card
              title="Time in Mellox, per person"
              icon={Clock}
              action={
                <Pills
                  value={range}
                  onChange={setRange}
                  items={[
                    { id: "7d", label: "7 days" },
                    { id: "14d", label: "14 days" },
                  ]}
                />
              }
            >
              {people.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                  Nobody yet in this window.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {shownPeople.map((person) => (
                    <li key={person.userId}>
                      <button
                        type="button"
                        disabled={!canOpen}
                        onClick={() => open(person.userId)}
                        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-1.5 py-1.5 text-left hover:bg-foreground/[0.03] disabled:hover:bg-transparent"
                      >
                        <Avatar name={personName(person)} id={person.userId} size={32} />
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-[13px] font-semibold">
                              {personName(person)}
                            </span>
                            <PlanPill planId={person.planId} label={person.planLabel} />
                          </span>
                          <span className="mt-1 block h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${Math.max(3, Math.round((person.mins / people[0].mins) * 100))}%`,
                                background: "linear-gradient(90deg,#4f8ef7,#1fd6c4)",
                                transition: "width 800ms cubic-bezier(0.16,1,0.3,1)",
                              }}
                            />
                          </span>
                          {person.topActivities.length > 0 && (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {person.topActivities.map((a) => (
                                <span
                                  key={a.label}
                                  className="rounded-full bg-foreground/[0.05] px-2 py-0.5 text-[10.5px] text-muted-foreground"
                                >
                                  {a.label} · {a.count}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                        <span className="text-right">
                          <span className="block text-[14px] font-semibold tabular-nums">
                            {minutes(person.mins)}
                          </span>
                          <span className="block text-[10.5px] text-muted-foreground">
                            {person.actions7d} actions
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {people.length > 12 && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-2 w-full rounded-full py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                >
                  {showAll ? "Show fewer" : `Show all ${people.length}`}
                </button>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Estimated: actions less than 20 minutes apart count as one visit.
              </p>
            </Card>

            <Card title="Latest here" icon={Activity}>
              {recent.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">Nobody yet.</p>
              ) : (
                <ul className="grid gap-1.5">
                  {recent.map((person) => {
                    const live = Date.now() - Date.parse(person.lastActiveAt!) < 15 * 60_000;
                    return (
                      <li key={person.userId}>
                        <button
                          type="button"
                          disabled={!canOpen}
                          onClick={() => open(person.userId)}
                          className="flex w-full items-center gap-2.5 rounded-xl px-1 py-1.5 text-left hover:bg-foreground/[0.03] disabled:hover:bg-transparent"
                        >
                          <span className="relative">
                            <Avatar name={personName(person)} id={person.userId} size={30} />
                            {live && (
                              <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-success ring-2 ring-[var(--ds-tile-bg)]" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12.5px] font-medium">
                              {personName(person)}
                            </span>
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {person.lastDoing ?? "Using Mellox"}
                            </span>
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {live ? "now" : ago(person.lastActiveAt)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <div id="workspaces" className="mt-3 scroll-mt-4">
            <Card
              title={`New workspaces · 30 days (${data.newWorkspaces.length})`}
              icon={Building2}
            >
              {data.newWorkspaces.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">None yet.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {data.newWorkspaces.map((ws) => (
                    <li key={ws.id}>
                      <button
                        type="button"
                        disabled={!canOpen}
                        onClick={() => open(ws.ownerId)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-[var(--ds-tile-border)] p-3 text-left transition-transform hover:-translate-y-0.5 disabled:hover:translate-y-0"
                      >
                        <Avatar name={ws.name} id={ws.id} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold">
                            {ws.name}
                          </span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">
                            by {personName({ name: ws.ownerName, email: ws.ownerEmail })} ·{" "}
                            {ws.ownerPlan}
                          </span>
                          <span
                            className="block text-[11px] text-muted-foreground"
                            title={fmtDateTime(ws.createdAt)}
                          >
                            {ago(ws.createdAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </SurfacePage>
  );
}
