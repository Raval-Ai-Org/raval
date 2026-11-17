"use client";

// Customers — every person, grouped by plan: credits left, time in Mellox,
// what they do most, errors and when they were last here. Filters are pills
// (plan, then a quick view), the list opens the person's admin page.

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SurfacePage } from "@/components/app/surface/SurfaceLayout";
import { dsGhostBtn } from "@/components/app/surface/buttons";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Clock, Download, Search, Sparkles, Users } from "@/components/icons";
import { hasPermission } from "@/lib/admin/permissions";
import { toCsv } from "@/lib/admin/csv";
import type { AdminPulseCustomer } from "@/lib/admin/types";
import { UNITS_PER_CREDIT } from "@/lib/billing/catalog";
import { cn } from "@/lib/utils";
import { useAdminMe } from "./api";
import { LoadError } from "./LoadError";
import { ago } from "./format";
import {
  Avatar,
  Card,
  CountUp,
  CreditBar,
  Kpi,
  PlanDonut,
  PlanPill,
  Pills,
  credits,
  minutes,
  personName,
  planColor,
  usePulse,
} from "./pulse-ui";

type View = "all" | "paying" | "active" | "low" | "quiet" | "errors";
type Sort = "recent" | "time" | "credits" | "newest" | "errors";

const VIEWS: Array<{ id: View; label: string; test: (c: AdminPulseCustomer) => boolean }> = [
  { id: "all", label: "Everyone", test: () => true },
  { id: "paying", label: "Paying", test: (c) => c.planId !== "free" && c.status !== "none" },
  {
    id: "active",
    label: "Active this week",
    test: (c) =>
      Boolean(c.lastActiveAt) && Date.now() - Date.parse(c.lastActiveAt!) <= 7 * 86_400_000,
  },
  {
    id: "low",
    label: "Low on credits",
    test: (c) =>
      c.planId !== "free" && c.creditsAllowance > 0 && c.creditsLeft / c.creditsAllowance < 0.1,
  },
  {
    id: "quiet",
    label: "Quiet 7+ days",
    test: (c) => !c.lastActiveAt || Date.now() - Date.parse(c.lastActiveAt) > 7 * 86_400_000,
  },
  { id: "errors", label: "Had errors", test: (c) => c.errors7d > 0 },
];

const SORTS: Record<
  Sort,
  { label: string; compare: (a: AdminPulseCustomer, b: AdminPulseCustomer) => number }
> = {
  recent: {
    label: "Last active",
    compare: (a, b) =>
      (b.lastActiveAt ? Date.parse(b.lastActiveAt) : 0) -
      (a.lastActiveAt ? Date.parse(a.lastActiveAt) : 0),
  },
  time: { label: "Most time", compare: (a, b) => b.activeMinutes7d - a.activeMinutes7d },
  credits: { label: "Fewest credits", compare: (a, b) => a.creditsLeft - b.creditsLeft },
  newest: { label: "Newest", compare: (a, b) => Date.parse(b.joinedAt) - Date.parse(a.joinedAt) },
  errors: { label: "Most errors", compare: (a, b) => b.errors7d - a.errors7d },
};

const PAGE = 40;

function download(rows: AdminPulseCustomer[]) {
  const csv = toCsv(
    [
      "Name",
      "Email",
      "Plan",
      "Credits left",
      "Monthly credits",
      "Workspaces",
      "Minutes (7d)",
      "Actions (7d)",
      "Pieces (7d)",
      "Errors (7d)",
      "Last active",
      "Joined",
    ],
    rows.map((c) => [
      c.name ?? "",
      c.email ?? "",
      c.planLabel,
      Math.round((c.creditsLeft / UNITS_PER_CREDIT) * 10) / 10,
      Math.round(c.creditsAllowance / UNITS_PER_CREDIT),
      c.workspaces,
      c.activeMinutes7d,
      c.actions7d,
      c.pieces7d,
      c.errors7d,
      c.lastActiveAt ?? "",
      c.joinedAt,
    ]),
  );
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `mellox-customers-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function LastSeen({ at, doing }: { at: string | null; doing: string | null }) {
  if (!at) return <span className="text-[12px] text-muted-foreground">Not yet</span>;
  const live = Date.now() - Date.parse(at) < 15 * 60_000;
  return (
    <span className="block min-w-0">
      <span className="flex items-center gap-1.5 text-[12px] font-medium">
        {live && <span className="size-2 shrink-0 animate-pulse rounded-full bg-success" />}
        {live ? "Here now" : ago(at)}
      </span>
      {doing && <span className="block truncate text-[11px] text-muted-foreground">{doing}</span>}
    </span>
  );
}

export function CustomersScreen() {
  const me = useAdminMe();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pulse = usePulse();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [shown, setShown] = useState(PAGE);
  const plan = params.get("plan") ?? "all";
  const view = (VIEWS.find((v) => v.id === params.get("view"))?.id ?? "all") as View;
  const canOpen = me.data ? hasPermission(me.data.permissions, "users.read") : false;

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === "all") next.delete(key);
    else next.set(key, value);
    setShown(PAGE);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const customers = useMemo(() => pulse.data?.customers ?? [], [pulse.data]);
  const inPlan = useMemo(
    () => (plan === "all" ? customers : customers.filter((c) => c.planId === plan)),
    [customers, plan],
  );
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const test = VIEWS.find((v) => v.id === view)!.test;
    return inPlan
      .filter(test)
      .filter(
        (c) =>
          !needle ||
          (c.name ?? "").toLowerCase().includes(needle) ||
          (c.email ?? "").toLowerCase().includes(needle),
      )
      .sort(SORTS[sort].compare);
  }, [inPlan, view, search, sort]);

  const summary = useMemo(
    () => ({
      people: rows.length,
      credits: rows.reduce((s, c) => s + c.creditsLeft, 0),
      minutes: rows.reduce((s, c) => s + c.activeMinutes7d, 0),
      errors: rows.reduce((s, c) => s + c.errors7d, 0),
    }),
    [rows],
  );

  return (
    <SurfacePage
      title="Customers"
      subtitle="Everyone, by plan"
      actions={
        <button
          type="button"
          className={cn(dsGhostBtn, "h-9 px-3 text-[12.5px]")}
          onClick={() => download(rows)}
          disabled={!rows.length}
        >
          <Download className="size-3.5" /> Download list
        </button>
      }
    >
      {pulse.error && <LoadError error={pulse.error} onRetry={() => void pulse.refetch()} />}
      {pulse.isLoading && (
        <div className="grid gap-3">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      )}
      {pulse.data && (
        <>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <Card title="Plans" icon={Users}>
              <PlanDonut
                plans={pulse.data.plans}
                size={140}
                onPick={(id) => setParam("plan", plan === id ? "all" : id)}
              />
            </Card>
            <div className="grid grid-cols-2 gap-3">
              <Kpi
                label="People shown"
                value={<CountUp value={summary.people} />}
                icon={Users}
                color="#7c6cf2"
              />
              <Kpi
                label="Credits they hold"
                value={<CountUp value={summary.credits} format={(n) => credits(n)} />}
                icon={Sparkles}
                color="#3fbf5a"
              />
              <Kpi
                label="Time this week"
                value={minutes(summary.minutes)}
                icon={Clock}
                color="#4f8ef7"
              />
              <Kpi
                label="Errors this week"
                value={<CountUp value={summary.errors} />}
                icon={AlertTriangle}
                color={summary.errors ? "#e5484d" : "#94a3b8"}
              />
            </div>
          </div>

          <div className="mt-5 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5">
            <Pills
              value={plan}
              onChange={(id) => setParam("plan", id)}
              items={[
                { id: "all", label: "All plans", count: customers.length },
                ...pulse.data.plans.map((p) => ({
                  id: p.planId,
                  label: p.label,
                  count: p.accounts,
                  color: planColor(p.planId),
                })),
              ]}
            />
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Pills
                value={view}
                onChange={(id) => setParam("view", id)}
                items={VIEWS.map((v) => ({
                  id: v.id,
                  label: v.label,
                  count: inPlan.filter(v.test).length,
                }))}
              />
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <label className="relative min-w-0 flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setShown(PAGE);
                  }}
                  placeholder="Find a name or email"
                  className="h-9 w-full rounded-full border border-[var(--ds-tile-border)] bg-[var(--ds-tile-bg)] pl-8 pr-3 text-[12.5px] outline-none focus:border-foreground/30"
                />
              </label>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
                aria-label="Sort"
                className="h-9 rounded-full border border-[var(--ds-tile-border)] bg-[var(--ds-tile-bg)] px-3 text-[12.5px]"
              >
                {(Object.keys(SORTS) as Sort[]).map((key) => (
                  <option key={key} value={key}>
                    {SORTS[key].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <Card className="mt-3 p-0 sm:p-0">
            {rows.length === 0 ? (
              <p className="px-4 py-12 text-center text-[13px] text-muted-foreground">
                Nobody matches.
              </p>
            ) : (
              <ul>
                <li className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_8rem_5rem_4.5rem_4rem_minmax(0,1.3fr)] gap-3 border-b border-border/60 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
                  <span>Person</span>
                  <span>Plan</span>
                  <span>Credits left</span>
                  <span>Time 7d</span>
                  <span>Spaces</span>
                  <span>Errors</span>
                  <span>Last here</span>
                </li>
                {rows.slice(0, shown).map((c) => (
                  <li key={c.userId} className="border-b border-border/40 last:border-0">
                    <button
                      type="button"
                      disabled={!canOpen}
                      onClick={() => router.push(`/admin/users/${c.userId}`)}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-foreground/[0.03] disabled:hover:bg-transparent lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_8rem_5rem_4.5rem_4rem_minmax(0,1.3fr)]"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={personName(c)} id={c.userId} size={34} />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold">
                            {personName(c)}
                          </span>
                          <span className="block truncate text-[11.5px] text-muted-foreground">
                            {c.email ?? "—"} · joined {ago(c.joinedAt)}
                          </span>
                        </span>
                      </span>
                      <span className="justify-self-end lg:justify-self-start">
                        <PlanPill planId={c.planId} label={c.planLabel} />
                      </span>
                      <span className="col-span-2 lg:col-span-1">
                        {c.planId === "free" && c.creditsAllowance === 0 ? (
                          <span className="text-[12px] text-muted-foreground">No credits</span>
                        ) : (
                          <CreditBar left={c.creditsLeft} allowance={c.creditsAllowance} />
                        )}
                      </span>
                      <span className="text-[12.5px] font-medium tabular-nums">
                        <span className="text-muted-foreground lg:hidden">Time </span>
                        {minutes(c.activeMinutes7d)}
                      </span>
                      <span className="text-right text-[12.5px] tabular-nums lg:text-left">
                        <span className="text-muted-foreground lg:hidden">Spaces </span>
                        {c.workspaces}
                      </span>
                      <span className="text-[12.5px] tabular-nums">
                        {c.errors7d ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 font-semibold text-destructive">
                            {c.errors7d}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </span>
                      <span className="justify-self-end text-right lg:justify-self-start lg:text-left">
                        <LastSeen at={c.lastActiveAt} doing={c.lastDoing} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {rows.length > shown && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                className={cn(dsGhostBtn, "h-9 px-4 text-[12.5px]")}
                onClick={() => setShown((n) => n + PAGE)}
              >
                Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}
              </button>
            </div>
          )}
        </>
      )}
    </SurfacePage>
  );
}
