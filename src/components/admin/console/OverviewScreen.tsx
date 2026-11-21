"use client";

// Overview — the admin home. Money first (Stripe, OpenRouter, KIE and the
// credits customers still hold), then who is here, a 14-day picture, the plan
// mix, who uses Mellox most, what needs attention and the live feed. Pictures
// first, few words; every number links to the page with the detail.

import { useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SurfacePage } from "@/components/app/surface/SurfaceLayout";
import { dsGhostBtn } from "@/components/app/surface/buttons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Bot,
  Building2,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Sparkles,
  UserPlus,
  Users,
  Video,
  Wallet,
  RefreshCw,
  Activity,
  ShoppingBag,
  Megaphone,
} from "@/components/icons";
import type { AdminBalances, AdminProviderBalance, AdminPulse } from "@/lib/admin/types";
import { hasPermission } from "@/lib/admin/permissions";
import { cn } from "@/lib/utils";
import { useAdminMe } from "./api";
import { LoadError } from "./LoadError";
import { ago } from "./format";
import {
  Avatar,
  BarRow,
  Card,
  CountUp,
  Kpi,
  PlanDonut,
  Pills,
  Ring,
  SERIES,
  cents,
  credits,
  minutes,
  personName,
  shortDay,
  usd,
  useBalances,
  usePulse,
  type SeriesKey,
} from "./pulse-ui";

// ── Money ──────────────────────────────────────────────────────────────────

function StateDot({ state }: { state: AdminProviderBalance["state"] | "live" }) {
  const map = {
    live: ["#3fbf5a", "Live"],
    manual: ["#f5a524", "Typed in"],
    unavailable: ["#e5484d", "Can't read"],
    not_configured: ["#b8bec9", "Not set up"],
  } as const;
  const [color, label] = map[state];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span className="relative flex size-2">
        {state === "live" && (
          <span
            className="absolute inline-flex size-full animate-ping rounded-full opacity-60"
            style={{ background: color }}
          />
        )}
        <span className="relative inline-flex size-2 rounded-full" style={{ background: color }} />
      </span>
      {label}
    </span>
  );
}

function MoneyCard({
  title,
  icon: Icon,
  color,
  children,
  footer,
  loading,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-2">
        <span
          className="grid size-8 place-items-center rounded-xl text-white"
          style={{ background: color }}
        >
          <Icon className="size-4" />
        </span>
        <span className="text-[13px] font-semibold">{title}</span>
      </div>
      <div className="mt-3 flex min-h-[84px] flex-1 items-center gap-3">
        {loading ? <Skeleton className="h-20 w-full rounded-xl" /> : children}
      </div>
      {footer && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/50 pt-2.5">
          {footer}
        </div>
      )}
    </Card>
  );
}

function ProviderCard({
  provider,
  color,
  icon,
  loading,
}: {
  provider: AdminProviderBalance | undefined;
  color: string;
  icon: ComponentType<{ className?: string }>;
  loading: boolean;
}) {
  const balance = provider?.balanceUsd ?? null;
  const reserve = provider?.reserveUsd ?? 0;
  const enough = balance !== null && balance >= reserve;
  return (
    <MoneyCard
      title={provider?.label ?? "Provider"}
      icon={icon}
      color={color}
      loading={loading}
      footer={
        provider && (
          <>
            <StateDot state={provider.state} />
            <a
              href={provider.topUpUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
            >
              Top up <ExternalLink className="size-3" />
            </a>
          </>
        )
      }
    >
      {provider && (
        <>
          <Ring
            value={balance ?? 0}
            max={Math.max(reserve, balance ?? 0, 1)}
            color={balance === null ? "#b8bec9" : enough ? "#3fbf5a" : "#e5484d"}
          >
            <span className="text-[11px] font-semibold">
              {balance === null ? "?" : enough ? "OK" : "Low"}
            </span>
          </Ring>
          <div className="min-w-0">
            <div className="text-[24px] font-semibold leading-none tracking-tight">
              {balance === null ? "—" : <CountUp value={balance} format={(n) => usd(n)} />}
            </div>
            {provider.balanceCredits !== null && (
              <div className="mt-1 text-[11.5px] text-muted-foreground tabular-nums">
                {Math.round(provider.balanceCredits).toLocaleString()} KIE credits
              </div>
            )}
            <div className="mt-1 text-[11.5px] text-muted-foreground">
              Customers can use {usd(reserve, 0)}
            </div>
          </div>
        </>
      )}
    </MoneyCard>
  );
}

function StripeCard({
  stripe,
  loading,
  canSee,
}: {
  stripe: AdminBalances["stripe"] | undefined;
  loading: boolean;
  canSee: boolean;
}) {
  return (
    <MoneyCard
      title="Stripe"
      icon={CreditCard}
      color="#635bff"
      loading={loading && canSee}
      footer={
        stripe?.configured ? (
          <>
            <StateDot state="live" />
            <span className="text-[11px] text-muted-foreground">
              {stripe.livemode ? "Live mode" : "Test mode"}
            </span>
          </>
        ) : undefined
      }
    >
      {!canSee ? (
        <p className="text-[12.5px] text-muted-foreground">For billing admins only.</p>
      ) : !stripe || !stripe.configured ? (
        <p className="text-[12.5px] text-muted-foreground">
          Stripe isn&apos;t connected on the server.
        </p>
      ) : (
        <div className="min-w-0">
          <div className="text-[11.5px] font-medium text-muted-foreground">Ready to pay out</div>
          <div className="mt-1 text-[26px] font-semibold leading-none tracking-tight">
            <CountUp value={stripe.availableCents} format={(n) => cents(n, stripe.currency)} />
          </div>
          <div className="mt-1.5 text-[11.5px] text-muted-foreground">
            + {cents(stripe.pendingCents, stripe.currency)} on the way
          </div>
        </div>
      )}
    </MoneyCard>
  );
}

function CustomerCreditsCard({ pulse }: { pulse: AdminPulse | undefined }) {
  const totals = pulse?.totals;
  return (
    <MoneyCard
      title="Customer credits"
      icon={Sparkles}
      color="#3fbf5a"
      loading={!pulse}
      footer={
        totals && (
          <span className="text-[11.5px] text-muted-foreground">
            {totals.payingCustomers} paying {totals.payingCustomers === 1 ? "person" : "people"}
          </span>
        )
      }
    >
      {totals && (
        <>
          <Ring value={totals.creditsLeft} max={totals.creditsAllowance}>
            <span className="text-[11px] font-semibold tabular-nums">
              {totals.creditsAllowance
                ? `${Math.round((totals.creditsLeft / totals.creditsAllowance) * 100)}%`
                : "—"}
            </span>
          </Ring>
          <div className="min-w-0">
            <div className="text-[24px] font-semibold leading-none tracking-tight">
              <CountUp value={totals.creditsLeft} format={(n) => credits(n)} />
            </div>
            <div className="mt-1 text-[11.5px] text-muted-foreground">
              left of {credits(totals.creditsAllowance)} a month
            </div>
          </div>
        </>
      )}
    </MoneyCard>
  );
}

// ── Trend ──────────────────────────────────────────────────────────────────

function TrendCard({ days }: { days: AdminPulse["days"] }) {
  const [shown, setShown] = useState<SeriesKey>("activeUsers");
  const data = days.map((day) => ({ ...day, label: shortDay(day.day) }));
  const total = days.reduce((sum, day) => sum + day[shown], 0);
  const series = SERIES[shown];
  return (
    <Card title="Last 14 days" icon={Activity} className="lg:col-span-2">
      <Pills
        value={shown}
        onChange={setShown}
        items={(Object.keys(SERIES) as SeriesKey[]).map((key) => ({
          id: key,
          label: SERIES[key].label,
          color: SERIES[key].color,
        }))}
      />
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[28px] font-semibold leading-none tabular-nums">
          <CountUp value={total} />
        </span>
        <span className="text-[12px] text-muted-foreground">
          {shown === "activeUsers" ? "person-days active" : series.label.toLowerCase()} in 14 days
        </span>
      </div>
      <div className="mt-3 h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
            <defs>
              <linearGradient id={`trend-${shown}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={series.color} stopOpacity={0.45} />
                <stop offset="100%" stopColor={series.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 6" className="stroke-border" />
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
              contentStyle={{ borderRadius: 12, fontSize: 12 }}
              formatter={(value: number) => [value, series.label]}
            />
            <Area
              type="monotone"
              dataKey={shown}
              stroke={series.color}
              strokeWidth={2.5}
              fill={`url(#trend-${shown})`}
              animationDuration={700}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ── Attention and feed ─────────────────────────────────────────────────────

type Alert = { id: string; tone: "danger" | "warning"; text: string; href: string };

function alertsFor(pulse: AdminPulse, balances: AdminBalances | undefined): Alert[] {
  const out: Alert[] = [];
  for (const provider of balances?.providers ?? []) {
    if (provider.balanceUsd !== null && provider.balanceUsd < provider.reserveUsd) {
      out.push({
        id: `low-${provider.id}`,
        tone: "danger",
        text: `${provider.label} is below what customers can spend (${usd(provider.balanceUsd)} of ${usd(provider.reserveUsd, 0)})`,
        href: "/admin/revenue",
      });
    } else if (provider.state === "unavailable") {
      out.push({
        id: `read-${provider.id}`,
        tone: "warning",
        text: `${provider.label} balance can't be read`,
        href: "/admin/revenue",
      });
    }
  }
  if (pulse.totals.errors24h > 0) {
    out.push({
      id: "errors",
      tone: pulse.totals.errors24h >= 10 ? "danger" : "warning",
      text: `${pulse.totals.errors24h} errors in the last 24 hours`,
      href: "/admin/errors",
    });
  }
  const low = pulse.customers.filter(
    (c) =>
      c.planId !== "free" && c.creditsAllowance > 0 && c.creditsLeft / c.creditsAllowance < 0.1,
  );
  if (low.length) {
    out.push({
      id: "low-credits",
      tone: "warning",
      text: `${low.length} paying ${low.length === 1 ? "person is" : "people are"} nearly out of credits`,
      href: "/admin/customers?view=low",
    });
  }
  const quiet = pulse.customers.filter(
    (c) =>
      c.planId !== "free" &&
      (!c.lastActiveAt || Date.now() - Date.parse(c.lastActiveAt) > 7 * 86_400_000),
  );
  if (quiet.length) {
    out.push({
      id: "quiet",
      tone: "warning",
      text: `${quiet.length} paying ${quiet.length === 1 ? "person hasn't" : "people haven't"} used Mellox this week`,
      href: "/admin/customers?view=quiet",
    });
  }
  return out;
}

const FEED_ICONS: Record<
  AdminPulse["feed"][number]["kind"],
  ComponentType<{ className?: string }>
> = {
  subscription: CreditCard,
  purchase: ShoppingBag,
  signup: UserPlus,
  workspace: Building2,
  upgrade_request: Sparkles,
  announcement: Megaphone,
  job_failed: AlertTriangle,
};
const FEED_TONES: Record<AdminPulse["feed"][number]["tone"], string> = {
  success: "#3fbf5a",
  primary: "#1fd6c4",
  warning: "#f5a524",
  danger: "#e5484d",
  neutral: "#94a3b8",
};

function Feed({ items }: { items: AdminPulse["feed"] }) {
  const router = useRouter();
  if (!items.length) {
    return <p className="py-6 text-center text-[12.5px] text-muted-foreground">Quiet so far.</p>;
  }
  return (
    <ol className="relative grid gap-0.5">
      <span aria-hidden className="absolute bottom-3 left-[15px] top-3 w-px bg-border" />
      {items.slice(0, 12).map((item) => {
        const Icon = FEED_ICONS[item.kind] ?? Activity;
        return (
          <li key={item.id}>
            <button
              type="button"
              disabled={!item.href}
              onClick={() => item.href && router.push(item.href)}
              className="relative flex w-full items-center gap-3 rounded-xl px-0.5 py-1.5 text-left hover:bg-foreground/[0.03] disabled:hover:bg-transparent"
            >
              <span
                className="relative z-10 grid size-[30px] shrink-0 place-items-center rounded-full text-white ring-4 ring-[var(--ds-tile-bg)]"
                style={{ background: FEED_TONES[item.tone] }}
              >
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{item.title}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground">
                  {item.detail}
                </span>
              </span>
              {item.amountUsd !== null && (
                <span className="text-[12px] font-semibold text-success tabular-nums">
                  {usd(item.amountUsd)}
                </span>
              )}
              <span className="w-14 shrink-0 text-right text-[11px] text-muted-foreground">
                {ago(item.occurredAt)}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function OverviewScreen() {
  const me = useAdminMe();
  const router = useRouter();
  const pulse = usePulse();
  const balances = useBalances();
  const data = pulse.data;
  const canOpenUsers = me.data ? hasPermission(me.data.permissions, "users.read") : false;
  const busy = pulse.isFetching || balances.isFetching;

  const topPeople = useMemo(
    () =>
      (data?.customers ?? [])
        .filter((c) => c.activeMinutes7d > 0)
        .sort((a, b) => b.activeMinutes7d - a.activeMinutes7d)
        .slice(0, 6),
    [data],
  );
  const alerts = useMemo(() => (data ? alertsFor(data, balances.data) : []), [data, balances.data]);
  const openRouter = balances.data?.providers.find((p) => p.id === "openrouter");
  const kie = balances.data?.providers.find((p) => p.id === "kie");

  return (
    <SurfacePage
      title="Overview"
      subtitle="Money, people and what needs you"
      actions={
        <>
          {data && (
            <span className="text-[11.5px] text-muted-foreground">
              Updated {ago(data.generatedAt)}
            </span>
          )}
          <button
            type="button"
            className={cn(dsGhostBtn, "h-9 px-3 text-[12.5px]")}
            onClick={() => {
              void pulse.refetch();
              void balances.refetch();
            }}
            disabled={busy}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
            {busy ? "Fetching…" : "Fetch latest"}
          </button>
        </>
      }
    >
      {/* Money */}
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h4 className="ds-label">Money</h4>
        <button
          type="button"
          onClick={() => void balances.refetch()}
          disabled={balances.isFetching}
          className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-[12px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <RefreshCw className={cn("size-3.5", balances.isFetching && "animate-spin")} />
          {balances.isFetching ? "Checking balances…" : "Fetch balances"}
        </button>
      </div>
      {balances.error && (
        <LoadError error={balances.error} onRetry={() => void balances.refetch()} />
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StripeCard
          stripe={balances.data?.stripe}
          loading={balances.isLoading}
          canSee={me.data?.billing === true}
        />
        <ProviderCard
          provider={openRouter}
          color="#4f8ef7"
          icon={Bot}
          loading={balances.isLoading}
        />
        <ProviderCard provider={kie} color="#e86fb1" icon={Video} loading={balances.isLoading} />
        <CustomerCreditsCard pulse={data} />
      </div>
      {balances.data && (
        <p className="mt-1.5 text-right text-[11px] text-muted-foreground">
          Balances checked {ago(balances.data.fetchedAt)}
        </p>
      )}

      {pulse.error && (
        <div className="mt-6">
          <LoadError error={pulse.error} onRetry={() => void pulse.refetch()} />
        </div>
      )}
      {pulse.isLoading && (
        <div className="mt-6 grid gap-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      )}

      {data && (
        <>
          {/* People */}
          <h4 className="ds-label mb-2.5 mt-7">People</h4>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi
              label="People"
              value={<CountUp value={data.totals.users} />}
              hint={`+${data.totals.newUsers7d} this week`}
              icon={Users}
              color="#7c6cf2"
              onClick={() => router.push("/admin/customers")}
            />
            <Kpi
              label="Active today"
              value={<CountUp value={data.totals.activeToday} />}
              hint={`${data.totals.activeUsers7d} this week`}
              icon={Activity}
              color="#1fd6c4"
              onClick={() => router.push("/admin/activity")}
            />
            <Kpi
              label="Paying"
              value={<CountUp value={data.totals.payingCustomers} />}
              hint="on a plan now"
              icon={Wallet}
              color="#3fbf5a"
              onClick={() => router.push("/admin/customers?view=paying")}
            />
            <Kpi
              label="Workspaces"
              value={<CountUp value={data.totals.workspaces} />}
              hint={`+${data.totals.newWorkspaces7d} this week`}
              icon={Building2}
              color="#f5a524"
              onClick={() => router.push("/admin/activity#workspaces")}
            />
            <Kpi
              label="Time in Mellox"
              value={minutes(data.totals.minutes7d)}
              hint={`${data.totals.pieces7d} pieces made · 7d`}
              icon={Clock}
              color="#4f8ef7"
              onClick={() => router.push("/admin/activity")}
            />
            <Kpi
              label="Errors · 24h"
              value={<CountUp value={data.totals.errors24h} />}
              hint={`${data.totals.errors7d} this week`}
              icon={AlertTriangle}
              color={data.totals.errors24h ? "#e5484d" : "#94a3b8"}
              onClick={() => router.push("/admin/errors")}
            />
          </div>

          {/* Trend + plans */}
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <TrendCard days={data.days} />
            <Card
              title="Customers by plan"
              icon={Users}
              action={
                <button
                  type="button"
                  onClick={() => router.push("/admin/customers")}
                  className="text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
                >
                  See all
                </button>
              }
            >
              <PlanDonut
                plans={data.plans}
                size={150}
                onPick={(plan) => router.push(`/admin/customers?plan=${plan}`)}
              />
            </Card>
          </div>

          {/* Who + attention */}
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <Card
              title="Most time in Mellox · 7 days"
              icon={Clock}
              action={
                <button
                  type="button"
                  onClick={() => router.push("/admin/activity")}
                  className="text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
                >
                  Everyone
                </button>
              }
            >
              {topPeople.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                  Nobody has used Mellox this week.
                </p>
              ) : (
                <div className="grid gap-1">
                  {topPeople.map((person) => (
                    <BarRow
                      key={person.userId}
                      label={
                        <span className="flex min-w-0 items-center gap-2">
                          <Avatar name={personName(person)} id={person.userId} size={22} />
                          <span className="truncate">{personName(person)}</span>
                        </span>
                      }
                      value={person.activeMinutes7d}
                      max={topPeople[0].activeMinutes7d}
                      color="#4f8ef7"
                      display={minutes(person.activeMinutes7d)}
                      onClick={
                        canOpenUsers
                          ? () => router.push(`/admin/users/${person.userId}`)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                Estimated from the times of each person&apos;s actions.
              </p>
            </Card>

            <Card title="Needs you" icon={AlertTriangle}>
              {alerts.length === 0 ? (
                <div className="grid place-items-center gap-2 py-6 text-center">
                  <span className="grid size-11 place-items-center rounded-full bg-success/12 text-success">
                    <CheckCircle2 className="size-5" />
                  </span>
                  <p className="text-[13px] font-medium">All clear</p>
                </div>
              ) : (
                <ul className="grid gap-2">
                  {alerts.map((alert) => (
                    <li key={alert.id}>
                      <button
                        type="button"
                        onClick={() => router.push(alert.href)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-[12.5px] font-medium transition-colors",
                          alert.tone === "danger"
                            ? "border-destructive/25 bg-destructive/[0.06] hover:bg-destructive/[0.1]"
                            : "border-warning/25 bg-warning/[0.06] hover:bg-warning/[0.1]",
                        )}
                      >
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            alert.tone === "danger" ? "bg-destructive" : "bg-warning",
                          )}
                        />
                        <span className="min-w-0 flex-1">{alert.text}</span>
                        <span className="text-muted-foreground">›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Feed */}
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <Card title="What's happening" icon={Activity} className="lg:col-span-2">
              <Feed items={data.feed} />
            </Card>
            <Card title="New workspaces" icon={Building2}>
              {data.newWorkspaces.length === 0 ? (
                <p className="py-6 text-center text-[12.5px] text-muted-foreground">
                  None in 30 days.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {data.newWorkspaces.slice(0, 7).map((ws) => (
                    <li key={ws.id} className="flex items-center gap-2.5">
                      <Avatar name={ws.name} id={ws.id} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium">{ws.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {personName({ name: ws.ownerName, email: ws.ownerEmail })}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {ago(ws.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {data.truncated && (
            <p className="mt-4 text-[11.5px] text-muted-foreground">
              Very busy period: some counts show at least this many.
            </p>
          )}
        </>
      )}
    </SurfacePage>
  );
}
