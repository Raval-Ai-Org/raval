"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SurfacePage, GroupLabel, Stat, Tile } from "@/components/app/surface/SurfaceLayout";
import { dsGhostBtn } from "@/components/app/surface/buttons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  Building2,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  Gauge,
  Inbox,
  LineChart,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  Users,
  Video,
  Wallet,
} from "@/components/icons";
import type {
  AdminFinanceMoney,
  AdminFinanceOverview,
  AdminFundingOverview,
  AdminOverview,
} from "@/lib/admin/types";
import { cn } from "@/lib/utils";
import { adminApi, useAdminMe } from "./api";
import { LoadError } from "./LoadError";
import { ago, fmtDateTime, fmtNumber, fmtUsd } from "./format";
import { Chip, TableFrame, rowClass, td, th } from "./parts";

function money(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountCents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(amountCents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
}

function compactMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return value.toLocaleString();
  }
}

function amountFor(rows: AdminFinanceMoney[], currency: string): number {
  return rows.find((row) => row.currency === currency)?.amountCents ?? 0;
}

function otherBalances(rows: AdminFinanceMoney[], currency: string): string | undefined {
  const other = rows.filter((row) => row.currency !== currency && row.amountCents !== 0);
  return other.length
    ? other.map((row) => money(row.amountCents, row.currency)).join(" · ")
    : undefined;
}

function monthLabel(value: string): string {
  return new Date(`${value}-01T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    timeZone: "UTC",
  });
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (["paid", "active", "succeeded"].includes(status)) return "success";
  if (["pending", "in_transit", "trialing"].includes(status)) return "warning";
  if (["failed", "canceled"].includes(status)) return "danger";
  return "neutral";
}

function FinanceSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

function fundingTone(state: AdminFundingOverview["status"]): "success" | "warning" | "danger" {
  if (state === "healthy") return "success";
  if (state === "action_needed") return "danger";
  return "warning";
}

function formatVideoCredits(units: number): string {
  return (units / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function FundingDashboard({ data }: { data: AdminFundingOverview }) {
  const needsTopUp = data.providers.filter((item) => (item.shortfallUsd ?? 0) > 0);
  const accountsWithDebt = data.accounts.filter((account) =>
    Object.values(account.meters).some((meter) => meter.debt > 0),
  ).length;
  const statusCopy =
    data.status === "healthy"
      ? "Provider reserves cover every account"
      : data.status === "action_needed"
        ? `Add ${fmtUsd(data.calculation.verifiedTopUpUsd)} in provider credits now`
        : "Provider balance verification needed";

  return (
    <>
      <GroupLabel>Provider funding</GroupLabel>
      <Tile
        className={cn(
          "mb-3 overflow-hidden border",
          data.status === "healthy" && "border-success/25 bg-success/[0.045]",
          data.status === "action_needed" && "border-destructive/30 bg-destructive/[0.045]",
          data.status === "unverified" && "border-warning/30 bg-warning/[0.05]",
        )}
      >
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-full",
                data.status === "healthy"
                  ? "bg-success/12 text-success"
                  : data.status === "action_needed"
                    ? "bg-destructive/12 text-destructive"
                    : "bg-warning/12 text-warning",
              )}
            >
              {data.status === "healthy" ? (
                <CheckCircle2 className="size-5" />
              ) : (
                <AlertTriangle className="size-5" />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold">{statusCopy}</h3>
                <Chip tone={fundingTone(data.status)}>{data.status.replaceAll("_", " ")}</Chip>
              </div>
              <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-muted-foreground">
                Safe reserve target: {fmtUsd(data.calculation.totalReserveUsd)} across{" "}
                {fmtNumber(data.accounts.length)} billing accounts. {data.calculation.policy}.
                {data.calculation.unverifiedProviders > 0
                  ? ` ${fmtNumber(data.calculation.unverifiedProviders)} provider balance cannot be verified, so the known top-up is not the final total.`
                  : ` Every top-up amount below uses the live provider balance. Estimated checkout cash is ${fmtUsd(data.calculation.estimatedCashRequiredUsd)}, including OpenRouter's standard purchase fee.`}
              </p>
            </div>
          </div>
          {needsTopUp.length > 0 && (
            <div className="flex shrink-0 flex-wrap gap-2">
              {needsTopUp.map((item) => (
                <a
                  key={item.id}
                  href={item.topUpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    dsGhostBtn,
                    "h-9 border-destructive/25 px-3 text-[12px] text-destructive",
                  )}
                >
                  Add{" "}
                  {item.id === "kie" && item.shortfallCredits !== null
                    ? `${fmtNumber(item.shortfallCredits)} credits`
                    : fmtUsd(item.shortfallUsd ?? 0)}
                  <ExternalLink className="size-3.5" />
                </a>
              ))}
            </div>
          )}
        </div>
      </Tile>

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Safe reserve target"
          value={fmtUsd(data.calculation.totalReserveUsd)}
          icon={Gauge}
          hint={`${fmtNumber(data.accounts.length)} funded accounts`}
        />
        <Stat
          label="Provider credits to add"
          value={fmtUsd(data.calculation.verifiedTopUpUsd)}
          icon={Wallet}
          tone={data.calculation.verifiedTopUpUsd > 0 ? "destructive" : "success"}
          hint={
            data.calculation.unverifiedProviders > 0
              ? "Known minimum; verify unavailable balances"
              : "Exact from current live balances"
          }
        />
        <Stat
          label="Estimated checkout cash"
          value={fmtUsd(data.calculation.estimatedCashRequiredUsd)}
          icon={Wallet}
          tone={data.calculation.estimatedCashRequiredUsd > 0 ? "warning" : "success"}
          hint="Includes OpenRouter's standard 5.5% fee ($0.80 minimum)"
        />
        <Stat
          label="Balances verified"
          value={`${data.providers.length - data.calculation.unverifiedProviders}/${data.providers.length}`}
          icon={ShieldCheck}
          tone={data.calculation.unverifiedProviders > 0 ? "warning" : "success"}
          hint="Credit-backed AI providers"
        />
        <Stat
          label="Customer wallet debt"
          value={fmtNumber(accountsWithDebt)}
          icon={AlertTriangle}
          tone={accountsWithDebt > 0 ? "warning" : "success"}
          hint="Accounts with any meter debt"
        />
      </div>

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        {data.providers.map((item) => {
          const short = (item.shortfallUsd ?? 0) > 0;
          const verified = item.balanceUsd !== null;
          const progress = Math.min(100, item.coveragePercent ?? 0);
          return (
            <Tile key={item.id} className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-[14px] font-semibold">{item.label}</h4>
                    <Chip tone={!verified ? "warning" : short ? "danger" : "success"}>
                      {!verified ? "unverified" : short ? "top up" : "funded"}
                    </Chip>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">{item.message}</p>
                </div>
                <a
                  href={item.topUpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
                >
                  Top up <ExternalLink className="size-3" />
                </a>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Balance
                  </p>
                  <p className="mt-1 text-[18px] font-semibold tabular-nums">
                    {item.balanceUsd === null ? "—" : fmtUsd(item.balanceUsd)}
                  </p>
                  {item.balanceCredits !== null && (
                    <p className="text-[11px] text-muted-foreground">
                      {fmtNumber(item.balanceCredits)} credits
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Target
                  </p>
                  <p className="mt-1 text-[18px] font-semibold tabular-nums">
                    {fmtUsd(item.reserveUsd)}
                  </p>
                  {item.reserveCredits !== null && (
                    <p className="text-[11px] text-muted-foreground">
                      {fmtNumber(item.reserveCredits)} credits
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Add now
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-[18px] font-semibold tabular-nums",
                      short && "text-destructive",
                    )}
                  >
                    {item.shortfallUsd === null ? "Verify" : fmtUsd(item.shortfallUsd)}
                  </p>
                  {item.shortfallCredits !== null && (
                    <p className="text-[11px] text-muted-foreground">
                      {fmtNumber(item.shortfallCredits)} credits
                    </p>
                  )}
                  {item.cashRequiredUsd !== null && item.cashRequiredUsd !== item.shortfallUsd && (
                    <p className="text-[11px] text-muted-foreground">
                      {fmtUsd(item.cashRequiredUsd)} at checkout incl.{" "}
                      {fmtUsd(item.purchaseFeeUsd ?? 0)} fee
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-foreground/[0.07]">
                <div
                  className={cn("h-full rounded-full", short ? "bg-destructive" : "bg-success")}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
                <span>
                  {verified
                    ? `${fmtNumber(item.coveragePercent ?? 0)}% covered`
                    : "Coverage unknown"}
                </span>
                <span>
                  {item.balanceState} · checked {ago(item.checkedAt)}
                </span>
              </div>
            </Tile>
          );
        })}
      </div>

      <TableFrame label="Funding requirement by Mellox plan">
        <thead>
          <tr>
            <th className={th}>Plan</th>
            <th className={`${th} text-right`}>Accounts</th>
            <th className={`${th} text-right`}>OpenRouter</th>
            <th className={`${th} text-right`}>KIE</th>
            <th className={`${th} text-right`}>Combined reserve</th>
            <th className={`${th} text-right`}>Credits remaining</th>
            <th className={`${th} text-right`}>Video remaining</th>
          </tr>
        </thead>
        <tbody>
          {data.plans.map((plan) => (
            <tr key={plan.planId} className={rowClass}>
              <td className={`${td} font-medium`}>{plan.planLabel}</td>
              <td className={`${td} text-right tabular-nums`}>{fmtNumber(plan.accounts)}</td>
              <td className={`${td} text-right tabular-nums`}>
                {fmtUsd(plan.openRouterReserveUsd)}
              </td>
              <td className={`${td} text-right tabular-nums`}>{fmtUsd(plan.kieReserveUsd)}</td>
              <td className={`${td} text-right font-semibold tabular-nums`}>
                {fmtUsd(plan.totalReserveUsd)}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                {fmtNumber(plan.remaining.credits)}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                {formatVideoCredits(plan.remaining.video)} VC
              </td>
            </tr>
          ))}
        </tbody>
      </TableFrame>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {data.dependencies.map((item) => (
          <Tile key={item.id} className="flex items-start gap-3 p-4">
            <span
              className={cn(
                "mt-0.5 size-2.5 shrink-0 rounded-full",
                item.configured ? "bg-success" : "bg-warning",
              )}
            />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13px] font-semibold">{item.label}</p>
                <Chip tone={item.configured ? "success" : "warning"}>
                  {item.configured ? "configured" : "not configured"}
                </Chip>
              </div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                {item.billingModel} · {item.message}
              </p>
            </div>
          </Tile>
        ))}
      </div>

      <details className="mt-3 group" open={data.accounts.length <= 25}>
        <summary className="cursor-pointer list-none rounded-xl border border-border/60 bg-foreground/[0.025] px-4 py-3 text-[13px] font-semibold hover:bg-foreground/[0.045]">
          Customer credit ledger · {fmtNumber(data.accounts.length)} accounts
          <span className="ml-2 font-normal text-muted-foreground">
            General, video, Pro and Flash balances
          </span>
        </summary>
        <div className="mt-2">
          <TableFrame label="Customer balances and provider reserve contribution">
            <thead>
              <tr>
                <th className={th}>Account owner</th>
                <th className={th}>Plan</th>
                <th className={`${th} text-right`}>General</th>
                <th className={`${th} text-right`}>Video</th>
                <th className={`${th} text-right`}>Pro</th>
                <th className={`${th} text-right`}>Flash</th>
                <th className={`${th} text-right`}>Provider reserve</th>
                <th className={`${th} text-right`}>Next grant</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((account) => {
                const debt = Object.values(account.meters).reduce(
                  (sum, meter) => sum + meter.debt,
                  0,
                );
                return (
                  <tr key={account.accountId} className={rowClass}>
                    <td className={td}>
                      <Link
                        href={`/admin/billing?account=${encodeURIComponent(account.accountId)}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {account.ownerEmail ?? `${account.accountId.slice(0, 8)}…`}
                      </Link>
                      <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                        {account.accountId.slice(0, 13)}…
                      </p>
                    </td>
                    <td className={td}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{account.planLabel}</span>
                        <Chip
                          tone={account.reserveEligible ? statusTone(account.status) : "neutral"}
                        >
                          {account.status}
                        </Chip>
                        {debt > 0 && <Chip tone="danger">debt {fmtNumber(debt)}</Chip>}
                      </div>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {fmtNumber(account.meters.credits.available)}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      <span className="inline-flex items-center justify-end gap-1">
                        <Video className="size-3 text-muted-foreground" />
                        {formatVideoCredits(account.meters.video.available)} VC
                      </span>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {fmtNumber(account.meters.proMessages.available)}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {fmtNumber(account.meters.flashMessages.available)}
                    </td>
                    <td className={`${td} text-right font-medium tabular-nums`}>
                      {fmtUsd(account.reserve.totalUsd)}
                    </td>
                    <td className={`${td} whitespace-nowrap text-right text-muted-foreground`}>
                      {fmtDateTime(account.nextGrantAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>
        </div>
      </details>
    </>
  );
}

function RevenueChart({ data }: { data: Extract<AdminFinanceOverview, { configured: true }> }) {
  const rows = data.monthly.map((row) => ({
    month: row.month,
    received: row.receivedCents / 100,
    net: row.netRevenueCents / 100,
  }));
  const hasRevenue = rows.some((row) => row.received !== 0 || row.net !== 0);

  return (
    <Tile className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="text-[14px] font-semibold">Revenue trend</h5>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Gross receipts and net revenue after refunds, disputes and Stripe fees
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" /> Received
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-foreground/55" /> Net
          </span>
        </div>
      </div>
      {hasRevenue ? (
        <div className="h-60" aria-label="Revenue over the last 12 months">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="admin-revenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.26} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="hsl(var(--border))"
                strokeDasharray="3 3"
                vertical={false}
                opacity={0.5}
              />
              <XAxis
                dataKey="month"
                tickFormatter={monthLabel}
                stroke="hsl(var(--muted-foreground))"
                fontSize={10.5}
                tickLine={false}
                axisLine={false}
                minTickGap={18}
              />
              <YAxis
                tickFormatter={(value) => compactMoney(Number(value), data.currency)}
                stroke="hsl(var(--muted-foreground))"
                fontSize={10.5}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                labelFormatter={(value) => monthLabel(String(value))}
                formatter={(value, name) => [
                  money(Math.round(Number(value ?? 0) * 100), data.currency),
                  name === "received" ? "Received" : "Net revenue",
                ]}
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 12,
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="received"
                stroke="hsl(var(--primary))"
                strokeWidth={2.25}
                fill="url(#admin-revenue)"
                dot={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="net"
                stroke="hsl(var(--foreground))"
                strokeOpacity={0.62}
                strokeWidth={1.75}
                fill="none"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="grid h-60 place-items-center rounded-2xl bg-[var(--ds-well-bg)] text-center">
          <div>
            <LineChart className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-[13px] font-medium">No Stripe revenue yet</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              The chart will fill as live payments arrive.
            </p>
          </div>
        </div>
      )}
    </Tile>
  );
}

function PlanMix({ data }: { data: Extract<AdminFinanceOverview, { configured: true }> }) {
  const peak = Math.max(1, ...data.recurring.plans.map((plan) => plan.mrrCents));
  return (
    <Tile className="h-full">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h5 className="text-[14px] font-semibold">Plan mix</h5>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Active and past-due subscriptions
          </p>
        </div>
        <Chip tone="primary">{fmtNumber(data.recurring.active)} active</Chip>
      </div>
      {data.recurring.plans.length ? (
        <ul className="mt-5 space-y-4">
          {data.recurring.plans.map((plan) => (
            <li key={plan.name}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-[12.5px]">
                <span className="truncate font-medium">{plan.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {fmtNumber(plan.subscriptions)} · {money(plan.mrrCents, data.currency)} MRR
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {money(plan.revenue30dCents, data.currency)} collected in 30 days
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(3, (plan.mrrCents / peak) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-[13px] text-muted-foreground">No active Stripe plans yet.</p>
      )}
    </Tile>
  );
}

function PeriodSnapshot({ data }: { data: Extract<AdminFinanceOverview, { configured: true }> }) {
  return (
    <Tile className="overflow-hidden p-0">
      <div className="border-b border-border/60 px-4 py-4 sm:px-5">
        <h5 className="text-[14px] font-semibold">Revenue pulse</h5>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Exact Stripe balance activity in {data.currency.toUpperCase()}
        </p>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-5">
        {data.periods.map((period) => (
          <div
            key={period.key}
            className={cn(
              "border-b border-border/50 px-4 py-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0",
              period.key === "last30Days" && "bg-primary/[0.035]",
            )}
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              {period.label}
            </p>
            <p className="mt-2 text-[18px] font-semibold tabular-nums">
              {money(period.receivedCents, data.currency)}
            </p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              {money(period.netRevenueCents, data.currency)} net · {fmtNumber(period.sales)} sales
            </p>
          </div>
        ))}
      </div>
    </Tile>
  );
}

function MixBars({ rows }: { rows: Array<{ label: string; value: string; percent: number }> }) {
  return rows.length ? (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="mb-1.5 flex items-center justify-between gap-3 text-[12px]">
            <span className="truncate capitalize">{row.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{row.value}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(2, row.percent)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-[12.5px] text-muted-foreground">No payment data in this period.</p>
  );
}

function PaymentIntelligence({
  data,
}: {
  data: Extract<AdminFinanceOverview, { configured: true }>;
}) {
  const paymentTotal = Math.max(1, data.payments.succeeded30d);
  const currencyPeak = Math.max(1, ...data.payments.currencies.map((row) => row.payments));
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Tile>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h5 className="text-[14px] font-semibold">Payment performance</h5>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Last 30 days across Stripe charges
            </p>
          </div>
          <Chip tone={data.payments.failed30d ? "warning" : "success"}>
            {data.payments.successRatePercent === null
              ? "No attempts"
              : `${data.payments.successRatePercent.toFixed(1)}% success`}
          </Chip>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl bg-[var(--ds-well-bg)] p-3">
          <div>
            <p className="text-[11px] text-muted-foreground">Succeeded / failed</p>
            <p className="mt-1 text-[16px] font-semibold tabular-nums">
              {fmtNumber(data.payments.succeeded30d)} / {fmtNumber(data.payments.failed30d)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Average / largest</p>
            <p className="mt-1 text-[16px] font-semibold tabular-nums">
              {money(data.payments.averageOrderCents, data.currency)}
            </p>
            <p className="text-[10.5px] text-muted-foreground">
              {money(data.payments.largestOrderCents, data.currency)} largest
            </p>
          </div>
        </div>
        <p className="mb-3 mt-5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Payment methods
        </p>
        <MixBars
          rows={data.payments.methods.map((row) => ({
            label: row.method,
            value: `${fmtNumber(row.payments)} · ${row.sharePercent.toFixed(0)}%`,
            percent: (row.payments / paymentTotal) * 100,
          }))}
        />
      </Tile>
      <Tile>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h5 className="text-[14px] font-semibold">Invoice collections</h5>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Receivables and recovery health
            </p>
          </div>
          <Chip tone={data.invoices.overdue ? "danger" : "success"}>
            {data.invoices.collectionRatePercent === null
              ? "No invoices"
              : `${data.invoices.collectionRatePercent.toFixed(1)}% collected`}
          </Chip>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
          {[
            ["Outstanding", money(data.invoices.outstandingCents, data.currency)],
            ["Open", fmtNumber(data.invoices.open)],
            ["Overdue", fmtNumber(data.invoices.overdue)],
            ["Uncollectible", fmtNumber(data.invoices.uncollectible)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-[var(--ds-well-bg)] p-3">
              <p className="text-[10.5px] text-muted-foreground">{label}</p>
              <p className="mt-1 text-[14px] font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <p className="mb-3 mt-5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Currency mix · no conversion applied
        </p>
        <MixBars
          rows={data.payments.currencies.map((row) => ({
            label: row.currency.toUpperCase(),
            value: `${money(row.receivedCents, row.currency)} · ${fmtNumber(row.payments)}`,
            percent: (row.payments / currencyPeak) * 100,
          }))}
        />
        <p className="mt-4 text-[11.5px] text-muted-foreground">
          {data.invoices.nextCollectionAt
            ? `Next automatic collection ${fmtDateTime(data.invoices.nextCollectionAt)}`
            : "No automatic collection is currently scheduled."}
        </p>
      </Tile>
    </div>
  );
}

function RiskActivity({ data }: { data: Extract<AdminFinanceOverview, { configured: true }> }) {
  const rows = [
    ...data.payments.recentFailures.map((item) => ({
      id: item.id,
      type: "Failed payment",
      tone: "danger" as const,
      subject: item.customer,
      detail: item.reason,
      amount: money(item.amountCents, item.currency),
      at: item.failedAt,
    })),
    ...data.recentRefunds.map((item) => ({
      id: item.id,
      type: "Refund",
      tone: "warning" as const,
      subject: item.reason,
      detail: item.status,
      amount: money(item.amountCents, item.currency),
      at: item.createdAt,
    })),
    ...data.recentDisputes.map((item) => ({
      id: item.id,
      type: "Dispute",
      tone: "danger" as const,
      subject: item.reason,
      detail: item.status.replaceAll("_", " "),
      amount: money(item.amountCents, item.currency),
      at: item.createdAt,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);

  return rows.length ? (
    <TableFrame label="Recent payment exceptions">
      <thead>
        <tr>
          <th className={th}>Event</th>
          <th className={th}>Customer / reason</th>
          <th className={th}>Status</th>
          <th className={`${th} text-right`}>Amount</th>
          <th className={`${th} text-right`}>When</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.type}-${row.id}`} className={rowClass}>
            <td className={td}>
              <Chip tone={row.tone}>{row.type}</Chip>
            </td>
            <td className={`${td} max-w-64 truncate font-medium`}>{row.subject}</td>
            <td className={`${td} max-w-72 truncate capitalize text-muted-foreground`}>
              {row.detail}
            </td>
            <td className={`${td} text-right font-medium tabular-nums`}>{row.amount}</td>
            <td className={`${td} whitespace-nowrap text-right text-muted-foreground`}>
              {fmtDateTime(row.at)}
            </td>
          </tr>
        ))}
      </tbody>
    </TableFrame>
  ) : (
    <Tile className="flex items-center justify-between gap-3 text-[13px]">
      <span>No failed payments, refunds or disputes in the last 30 days.</span>
      <Chip tone="success">Clear</Chip>
    </Tile>
  );
}

function FinanceDashboard({ data }: { data: Extract<AdminFinanceOverview, { configured: true }> }) {
  const available = amountFor(data.balance.available, data.currency);
  const pending = amountFor(data.balance.pending, data.currency);
  const instant = amountFor(data.balance.instantAvailable, data.currency);
  const reserved = amountFor(data.balance.connectReserved, data.currency);
  const refundReserve =
    amountFor(data.balance.refundPrefundingAvailable, data.currency) +
    amountFor(data.balance.refundPrefundingPending, data.currency);
  const profit = data.last30Days.estimatedProfitCents;
  const issues =
    data.health.failedInvoices30d +
    data.health.openDisputes +
    data.health.failedPayouts30d +
    data.payments.failed30d;
  const urgentRequirements = [
    ...data.account.requirements.pastDue,
    ...data.account.requirements.currentlyDue,
  ];
  const coverageMessages = [...data.coverage.unavailable, ...data.coverage.truncated];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--ds-well-bg)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5 text-[12.5px]">
          <span
            className={cn(
              "relative flex size-2.5 shrink-0 rounded-full",
              data.account.chargesEnabled && data.account.payoutsEnabled
                ? "bg-success"
                : "bg-warning",
            )}
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-25 motion-reduce:hidden" />
          </span>
          <span className="truncate font-medium">
            {data.livemode ? "Live Stripe account" : "Stripe test mode"}
            {data.account.businessName ? ` · ${data.account.businessName}` : ""}
          </span>
          <span className="hidden text-muted-foreground sm:inline">
            · synced {ago(data.generatedAt)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <span>Charges {data.account.chargesEnabled ? "on" : "off"}</span>
          <span>·</span>
          <span>Payouts {data.account.payoutsEnabled ? "on" : "off"}</span>
          <span>·</span>
          <span>
            {data.account.country ?? "Global"} · {data.account.defaultCurrency.toUpperCase()}
          </span>
        </div>
      </div>

      {urgentRequirements.length > 0 && (
        <Tile className="mb-3 border-warning/30 bg-warning/[0.045]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-warning/12 text-warning">
              <ShieldCheck className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">Stripe needs account information</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {urgentRequirements
                  .slice(0, 4)
                  .map((item) => item.replaceAll(".", " › ").replaceAll("_", " "))
                  .join(" · ")}
                {urgentRequirements.length > 4 ? ` · +${urgentRequirements.length - 4} more` : ""}
              </p>
            </div>
          </div>
        </Tile>
      )}

      {coverageMessages.length > 0 && (
        <div className="mb-3 rounded-xl border border-warning/25 bg-warning/[0.04] px-4 py-2.5 text-[11.5px] text-muted-foreground">
          Partial Stripe coverage: {coverageMessages.join(", ")}. Available figures are still live;
          grant read access or narrow the date range when the account grows beyond 10,000 records.
        </div>
      )}

      <GroupLabel>Cash position</GroupLabel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Available to withdraw"
          value={money(available, data.currency)}
          icon={Wallet}
          tone="primary"
          hint={
            otherBalances(data.balance.available, data.currency) ||
            (instant > 0 ? `${money(instant, data.currency)} instant` : "Stripe balance now")
          }
        />
        <Stat
          label="Pending balance"
          value={money(pending, data.currency)}
          icon={CircleDot}
          hint={otherBalances(data.balance.pending, data.currency) || "On the way to available"}
        />
        <Stat
          label="Received · 30 days"
          value={money(data.last30Days.receivedCents, data.currency)}
          icon={Activity}
          tone="success"
          hint={`${fmtNumber(data.last30Days.sales)} successful payments`}
        />
        <Stat
          label="Withdrawn · 30 days"
          value={money(data.last30Days.paidOutCents, data.currency)}
          icon={ArrowDown}
          hint={`${fmtNumber(data.recentPayouts.filter((payout) => payout.status === "paid").length)} paid payouts shown below`}
        />
      </div>

      <GroupLabel>Revenue pulse</GroupLabel>
      <PeriodSnapshot data={data} />

      <GroupLabel>Revenue, cost & profit · last 30 days</GroupLabel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Net revenue after Stripe"
          value={money(data.last30Days.netRevenueCents, data.currency)}
          icon={LineChart}
          tone={data.last30Days.netRevenueCents >= 0 ? "success" : "destructive"}
          hint="After refunds, disputes and Stripe fees"
        />
        <Stat
          label="Stripe fees"
          value={money(data.last30Days.feesCents, data.currency)}
          hint="Taken from Stripe balance transactions"
        />
        <Stat
          label="Refunds"
          value={money(data.last30Days.refundsCents, data.currency)}
          icon={TrendingDown}
          tone={data.last30Days.refundsCents > 0 ? "warning" : "default"}
          hint={`${fmtNumber(data.health.refundedTransactions30d)} refund transactions`}
        />
        <Stat
          label="Estimated AI cost"
          value={
            data.last30Days.estimatedAiCostUsd === null
              ? "—"
              : fmtUsd(data.last30Days.estimatedAiCostUsd)
          }
          hint="Provider-reported Mellox usage"
        />
        <Stat
          label="Est. contribution profit"
          value={profit === null ? "—" : money(profit, data.currency)}
          icon={Wallet}
          tone={profit === null ? "default" : profit >= 0 ? "success" : "destructive"}
          hint="Net revenue minus measured AI cost"
        />
        <Stat
          label="Est. contribution margin"
          value={
            data.last30Days.marginPercent === null
              ? "—"
              : `${data.last30Days.marginPercent.toFixed(1)}%`
          }
          tone={
            data.last30Days.marginPercent === null
              ? "default"
              : data.last30Days.marginPercent >= 60
                ? "success"
                : data.last30Days.marginPercent >= 0
                  ? "warning"
                  : "destructive"
          }
          hint="Excludes payroll, marketing, tax and other overhead"
        />
      </div>

      <GroupLabel>Performance</GroupLabel>
      <RevenueChart data={data} />

      <GroupLabel>Growth & retention · last 30 days</GroupLabel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="New subscriptions"
          value={fmtNumber(data.recurring.new30d)}
          icon={Activity}
          tone="success"
          hint={`${fmtNumber(data.recurring.canceled30d)} canceled`}
        />
        <Stat
          label="Subscriber churn"
          value={
            data.recurring.churnPercent === null
              ? "—"
              : `${data.recurring.churnPercent.toFixed(1)}%`
          }
          tone={
            data.recurring.churnPercent === null
              ? "default"
              : data.recurring.churnPercent <= 3
                ? "success"
                : data.recurring.churnPercent <= 7
                  ? "warning"
                  : "destructive"
          }
          hint="Canceled ÷ active plus canceled"
        />
        <Stat
          label="Stripe customers"
          value={fmtNumber(data.customers.total)}
          icon={Users}
          hint={`${fmtNumber(data.customers.new30d)} new in 30 days`}
        />
        <Stat
          label="Repeat buyers"
          value={fmtNumber(data.customers.repeatBuyers30d)}
          hint="Customers with 2+ paid invoices in 30 days"
        />
      </div>

      <GroupLabel>Recurring business</GroupLabel>
      <div className="grid gap-3 lg:grid-cols-[1fr_1.35fr]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2">
          <Stat
            label="MRR"
            value={money(data.recurring.mrrCents, data.currency)}
            icon={LineChart}
            tone="primary"
            hint="Active list-price subscriptions"
          />
          <Stat
            label="ARR run rate"
            value={money(data.recurring.arrCents, data.currency)}
            hint="MRR × 12"
          />
          <Stat
            label="Trials"
            value={fmtNumber(data.recurring.trialing)}
            hint="Current Stripe trials"
          />
          <Stat
            label="At risk"
            value={fmtNumber(
              data.recurring.pastDue +
                data.recurring.canceling +
                data.recurring.unpaid +
                data.recurring.incomplete,
            )}
            tone={
              data.recurring.pastDue + data.recurring.canceling + data.recurring.unpaid > 0
                ? "warning"
                : "success"
            }
            hint={`${fmtNumber(data.recurring.pastDue)} past due · ${fmtNumber(data.recurring.canceling)} canceling · ${fmtNumber(data.recurring.paused)} paused`}
          />
        </div>
        <PlanMix data={data} />
      </div>

      <GroupLabel
        action={
          <Link href="/admin/billing" className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}>
            Open billing accounts
          </Link>
        }
      >
        Recent Stripe plan sales
      </GroupLabel>
      {data.recentSales.length ? (
        <TableFrame label="Recent Stripe plan sales">
          <thead>
            <tr>
              <th className={th}>Customer</th>
              <th className={th}>Plan or item</th>
              <th className={th}>Type</th>
              <th className={`${th} text-right`}>Received</th>
              <th className={`${th} text-right`}>Paid</th>
            </tr>
          </thead>
          <tbody>
            {data.recentSales.map((sale) => (
              <tr key={sale.id} className={rowClass}>
                <td className={`${td} max-w-48 truncate font-medium`}>{sale.customer}</td>
                <td className={`${td} max-w-64 truncate`}>{sale.item}</td>
                <td className={td}>
                  <Chip tone="success">{sale.kind}</Chip>
                </td>
                <td className={`${td} text-right font-medium tabular-nums`}>
                  {money(sale.amountCents, sale.currency)}
                </td>
                <td className={`${td} whitespace-nowrap text-right text-muted-foreground`}>
                  {fmtDateTime(sale.paidAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      ) : (
        <Tile className="text-[13px] text-muted-foreground">No paid Stripe invoices yet.</Tile>
      )}

      <GroupLabel>Payments & collections</GroupLabel>
      <PaymentIntelligence data={data} />

      {data.invoices.recentOpen.length > 0 && (
        <>
          <GroupLabel>Open invoices</GroupLabel>
          <TableFrame label="Open Stripe invoices">
            <thead>
              <tr>
                <th className={th}>Customer</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Outstanding</th>
                <th className={`${th} text-right`}>Due / next attempt</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.recentOpen.map((invoice) => (
                <tr key={invoice.id} className={rowClass}>
                  <td className={`${td} max-w-80 truncate font-medium`}>{invoice.customer}</td>
                  <td className={td}>
                    <Chip tone={invoice.status === "overdue" ? "danger" : "warning"}>
                      {invoice.status}
                    </Chip>
                  </td>
                  <td className={`${td} text-right font-medium tabular-nums`}>
                    {money(invoice.amountCents, invoice.currency)}
                  </td>
                  <td className={`${td} whitespace-nowrap text-right text-muted-foreground`}>
                    {invoice.nextAttemptAt
                      ? fmtDateTime(invoice.nextAttemptAt)
                      : invoice.dueAt
                        ? fmtDateTime(invoice.dueAt)
                        : "Not scheduled"}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </>
      )}

      {data.customers.top30d.length > 0 && (
        <>
          <GroupLabel>Top customers · last 30 days</GroupLabel>
          <TableFrame label="Top Stripe customers">
            <thead>
              <tr>
                <th className={th}>Customer</th>
                <th className={`${th} text-right`}>Payments</th>
                <th className={`${th} text-right`}>Collected</th>
              </tr>
            </thead>
            <tbody>
              {data.customers.top30d.map((customer) => (
                <tr key={customer.id} className={rowClass}>
                  <td className={`${td} max-w-96 truncate font-medium`}>{customer.name}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {fmtNumber(customer.payments)}
                  </td>
                  <td className={`${td} text-right font-medium tabular-nums`}>
                    {money(customer.receivedCents, customer.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </>
      )}

      <GroupLabel>Withdrawals & payment health</GroupLabel>
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Failed invoices · 30 days"
          value={fmtNumber(data.health.failedInvoices30d)}
          tone={data.health.failedInvoices30d > 0 ? "destructive" : "success"}
        />
        <Stat
          label="Open disputes"
          value={fmtNumber(data.health.openDisputes)}
          tone={data.health.openDisputes > 0 ? "destructive" : "success"}
        />
        <Stat
          label="Failed payouts · 30 days"
          value={fmtNumber(data.health.failedPayouts30d)}
          tone={data.health.failedPayouts30d > 0 ? "destructive" : "success"}
        />
        <Stat
          label="Finance attention"
          value={issues === 0 ? "Healthy" : `${fmtNumber(issues)} signals`}
          tone={issues === 0 ? "success" : "warning"}
          hint="Signals can refer to the same payment"
        />
      </div>
      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Payouts pending"
          value={money(data.payoutPipeline.pendingCents, data.currency)}
          hint="Created, not yet moving"
        />
        <Stat
          label="In transit"
          value={money(data.payoutPipeline.inTransitCents, data.currency)}
          tone="primary"
          hint={
            data.payoutPipeline.nextArrivalAt
              ? `Next arrival ${fmtDateTime(data.payoutPipeline.nextArrivalAt)}`
              : "No arrival scheduled"
          }
        />
        <Stat
          label="Connect reserve"
          value={money(reserved, data.currency)}
          hint="Held for connected-account balances"
        />
        <Stat
          label="Refund prefunding"
          value={money(refundReserve, data.currency)}
          hint="Available plus pending reserve"
        />
      </div>
      {data.recentPayouts.length ? (
        <TableFrame label="Recent Stripe payouts">
          <thead>
            <tr>
              <th className={th}>Payout</th>
              <th className={th}>Status</th>
              <th className={th}>Method</th>
              <th className={`${th} text-right`}>Amount</th>
              <th className={`${th} text-right`}>Arrival</th>
            </tr>
          </thead>
          <tbody>
            {data.recentPayouts.map((payout) => (
              <tr key={payout.id} className={rowClass}>
                <td className={`${td} font-mono text-[12px]`}>{payout.id}</td>
                <td className={td}>
                  <Chip tone={statusTone(payout.status)}>{payout.status.replaceAll("_", " ")}</Chip>
                </td>
                <td className={`${td} capitalize`}>{payout.method}</td>
                <td className={`${td} text-right font-medium tabular-nums`}>
                  {money(payout.amountCents, payout.currency)}
                </td>
                <td className={`${td} whitespace-nowrap text-right text-muted-foreground`}>
                  {fmtDateTime(payout.arrivalAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      ) : (
        <Tile className="text-[13px] text-muted-foreground">No Stripe payouts in 30 days.</Tile>
      )}

      <GroupLabel>Exceptions requiring attention</GroupLabel>
      <RiskActivity data={data} />
    </>
  );
}

export function OverviewScreen() {
  const me = useAdminMe();
  const router = useRouter();
  const overview = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: () => adminApi<AdminOverview>("/api/admin/overview"),
    refetchInterval: 60_000,
  });
  const finance = useQuery({
    queryKey: ["admin", "finance", "overview"],
    queryFn: () => adminApi<AdminFinanceOverview>("/api/admin/finance"),
    enabled: me.data?.billing === true,
    refetchInterval: 60_000,
    retry: 1,
  });
  const data = overview.data;
  const financial = finance.data;
  const lastUpdated = financial?.generatedAt ?? data?.generatedAt;

  return (
    <SurfacePage
      title="Company overview"
      subtitle={lastUpdated ? `Live business snapshot · updated ${ago(lastUpdated)}` : undefined}
      actions={
        <button
          type="button"
          className={cn(dsGhostBtn, "h-9 px-3 text-[12.5px]")}
          onClick={() => {
            void overview.refetch();
            if (me.data?.billing) void finance.refetch();
          }}
          disabled={overview.isFetching || finance.isFetching}
        >
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5",
              (overview.isFetching || finance.isFetching) && "animate-spin",
            )}
          />
          Refresh
        </button>
      }
    >
      {data?.funding && <FundingDashboard data={data.funding} />}

      {me.data?.billing && finance.isLoading && <FinanceSkeleton />}
      {me.data?.billing && finance.error && (
        <LoadError error={finance.error} onRetry={() => void finance.refetch()} />
      )}
      {financial?.configured === false && (
        <Tile className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-warning/12 text-warning">
            <Wallet className="size-4" />
          </span>
          <div>
            <p className="text-[13.5px] font-semibold">Stripe finance data is not connected</p>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Add STRIPE_SECRET_KEY to the server environment to show live balances, sales and
              payouts.
            </p>
          </div>
        </Tile>
      )}
      {financial?.configured === true && <FinanceDashboard data={financial} />}

      <GroupLabel>Company activity</GroupLabel>
      {overview.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
      )}
      {overview.error && (
        <LoadError error={overview.error} onRetry={() => void overview.refetch()} />
      )}
      {data && (
        <>
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
            <Stat
              label="Platform attention"
              value={fmtNumber(
                data.users.suspended + data.workspaces.frozen + data.jobs.studioFailed24h,
              )}
              icon={ShieldCheck}
              tone={
                data.users.suspended + data.workspaces.frozen + data.jobs.studioFailed24h > 0
                  ? "warning"
                  : "success"
              }
              hint={`${fmtNumber(data.jobs.studioRunning)} Studio jobs running`}
            />
          </div>
        </>
      )}
    </SurfacePage>
  );
}
