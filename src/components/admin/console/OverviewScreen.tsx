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
  ArrowDown,
  Building2,
  CircleDot,
  Inbox,
  LineChart,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  Users,
  Wallet,
} from "@/components/icons";
import type { AdminFinanceMoney, AdminFinanceOverview, AdminOverview } from "@/lib/admin/types";
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
