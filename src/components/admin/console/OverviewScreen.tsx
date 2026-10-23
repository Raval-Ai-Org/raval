"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
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
  CheckCircle2,
  ExternalLink,
  Gauge,
  LineChart,
  RefreshCw,
  ShieldCheck,
  Users,
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

function formatVideoCredits(units: number): string {
  return (units / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

function SignalBar({
  label,
  value,
  detail,
  width,
  tone = "primary",
}: {
  label: string;
  value: string;
  detail: string;
  width: number;
  tone?: "primary" | "success" | "warning" | "danger";
}) {
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <p className="text-[12.5px] font-medium">{label}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
        </div>
        <p className="shrink-0 text-[14px] font-semibold tabular-nums">{value}</p>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-foreground/[0.06]">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            tone === "primary" && "bg-primary",
            tone === "success" && "bg-success",
            tone === "warning" && "bg-warning",
            tone === "danger" && "bg-destructive",
          )}
          style={{ width: `${Math.max(width > 0 ? 3 : 0, Math.min(100, width))}%` }}
        />
      </div>
    </div>
  );
}

function CompanyPulse({
  data,
  canOpenBilling,
  onOpenBilling,
}: {
  data: AdminOverview;
  canOpenBilling: boolean;
  onOpenBilling: () => void;
}) {
  const attention = data.users.suspended + data.workspaces.frozen + data.jobs.studioFailed24h;
  const activePercent = percent(data.users.active7d, data.users.total);
  const paidPercent = percent(data.billing.payingAccounts, data.users.total);
  const workspacePercent = percent(data.workspaces.total, data.users.total);

  return (
    <section id="business-health" className="scroll-mt-24">
      <GroupLabel>Business at a glance</GroupLabel>
      <div className="grid gap-3 xl:grid-cols-[1.45fr_1fr]">
        <Tile className="relative overflow-hidden border-primary/15 bg-gradient-to-br from-primary/[0.075] via-card to-card p-5 sm:p-6">
          <div className="absolute -right-20 -top-24 size-64 rounded-full bg-primary/[0.07] blur-3xl" />
          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Chip tone={attention > 0 ? "warning" : "success"}>
                    {attention > 0
                      ? `${fmtNumber(attention)} need attention`
                      : "Operations healthy"}
                  </Chip>
                  <span className="text-[11.5px] text-muted-foreground">
                    {fmtNumber(data.jobs.studioRunning)} Studio jobs live
                  </span>
                </div>
                <h2 className="max-w-xl text-[22px] font-semibold leading-tight tracking-[-0.025em] sm:text-[26px]">
                  {fmtNumber(data.users.total)} people across {fmtNumber(data.workspaces.total)}{" "}
                  workspaces
                </h2>
                <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
                  {fmtNumber(data.users.new7d)} joined this week and{" "}
                  {fmtNumber(data.users.active7d)} signed in during the last 7 days.
                </p>
              </div>
              <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Activity className="size-5" />
              </span>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-primary/10 pt-5 sm:grid-cols-4">
              <div>
                <p className="text-[11px] text-muted-foreground">New this month</p>
                <p className="mt-1 text-[19px] font-semibold tabular-nums">
                  {fmtNumber(data.users.new30d)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Paying accounts</p>
                <p className="mt-1 text-[19px] font-semibold tabular-nums">
                  {fmtNumber(data.billing.payingAccounts)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Trials</p>
                <p className="mt-1 text-[19px] font-semibold tabular-nums">
                  {fmtNumber(data.billing.trialingAccounts)}
                </p>
              </div>
              <button
                type="button"
                className={cn(
                  "text-left",
                  canOpenBilling &&
                    "rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
                onClick={canOpenBilling ? onOpenBilling : undefined}
                disabled={!canOpenBilling}
              >
                <p className="text-[11px] text-muted-foreground">Upgrade requests</p>
                <p
                  className={cn(
                    "mt-1 text-[19px] font-semibold tabular-nums",
                    data.billing.pendingRequests > 0 && "text-primary",
                  )}
                >
                  {fmtNumber(data.billing.pendingRequests)}
                </p>
              </button>
            </div>
          </div>
        </Tile>

        <Tile className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold">Audience journey</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                From registered users to active customers
              </p>
            </div>
            <Gauge className="size-4 text-muted-foreground" />
          </div>
          <div className="mt-5 space-y-5">
            <SignalBar
              label="Registered"
              value={fmtNumber(data.users.total)}
              detail="All user accounts"
              width={100}
            />
            <SignalBar
              label="Active this week"
              value={`${activePercent.toFixed(1)}%`}
              detail={`${fmtNumber(data.users.active7d)} signed in`}
              width={activePercent}
              tone="success"
            />
            <SignalBar
              label="Workspace adoption"
              value={`${workspacePercent.toFixed(1)}%`}
              detail={`${fmtNumber(data.workspaces.total)} workspaces`}
              width={workspacePercent}
            />
            <SignalBar
              label="Paid conversion"
              value={`${paidPercent.toFixed(1)}%`}
              detail={`${fmtNumber(data.billing.payingAccounts)} paying accounts`}
              width={paidPercent}
              tone={paidPercent > 0 ? "success" : "warning"}
            />
          </div>
        </Tile>
      </div>
    </section>
  );
}

type OverviewAction = {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: "danger" | "warning" | "primary";
};

function ActionCenter({
  data,
  finance,
  canOpenBilling,
}: {
  data: AdminOverview;
  finance: Extract<AdminFinanceOverview, { configured: true }> | undefined;
  canOpenBilling: boolean;
}) {
  const actions: OverviewAction[] = [];
  const funding = data.funding;
  const failedJobs = data.jobs.studioFailed24h;
  const restrictedAccounts = data.users.suspended + data.workspaces.frozen;

  if (funding.calculation.verifiedTopUpUsd > 0) {
    actions.push({
      id: "funding",
      title: `Add ${fmtUsd(funding.calculation.verifiedTopUpUsd)} provider credit`,
      detail: `${funding.providers.filter((provider) => (provider.shortfallUsd ?? 0) > 0).length} provider balance${funding.providers.filter((provider) => (provider.shortfallUsd ?? 0) > 0).length === 1 ? "" : "s"} below target`,
      href: "#provider-funding",
      tone: "danger",
    });
  } else if (funding.calculation.unverifiedProviders > 0 && funding.accounts.length > 0) {
    actions.push({
      id: "funding-unverified",
      title: "Verify provider balances",
      detail: `${funding.calculation.unverifiedProviders} balance${funding.calculation.unverifiedProviders === 1 ? " is" : "s are"} unavailable`,
      href: "#provider-funding",
      tone: "warning",
    });
  }

  if (canOpenBilling && data.billing.pendingRequests > 0) {
    actions.push({
      id: "upgrades",
      title: `${fmtNumber(data.billing.pendingRequests)} upgrade request${data.billing.pendingRequests === 1 ? "" : "s"} waiting`,
      detail: "Review and approve customer plan requests",
      href: "/admin/billing",
      tone: "primary",
    });
  }

  if (failedJobs > 0) {
    actions.push({
      id: "jobs",
      title: `${fmtNumber(failedJobs)} Studio job${failedJobs === 1 ? "" : "s"} failed`,
      detail: "Failures recorded during the last 24 hours",
      href: "/admin/jobs",
      tone: "warning",
    });
  }

  if (restrictedAccounts > 0) {
    actions.push({
      id: "restrictions",
      title: `${fmtNumber(restrictedAccounts)} account restriction${restrictedAccounts === 1 ? "" : "s"}`,
      detail: `${fmtNumber(data.users.suspended)} suspended users, ${fmtNumber(data.workspaces.frozen)} frozen workspaces`,
      href: data.users.suspended > 0 ? "/admin/users" : "/admin/workspaces",
      tone: "warning",
    });
  }

  if (finance) {
    const stripeRequirements =
      finance.account.requirements.pastDue.length +
      finance.account.requirements.currentlyDue.length;
    const financeIssues =
      finance.health.failedInvoices30d +
      finance.health.openDisputes +
      finance.health.failedPayouts30d +
      finance.payments.failed30d;

    if (stripeRequirements > 0) {
      actions.push({
        id: "stripe-requirements",
        title: "Stripe account information required",
        detail: `${fmtNumber(stripeRequirements)} requirement${stripeRequirements === 1 ? "" : "s"} currently due`,
        href: "#finance-operations",
        tone: "danger",
      });
    } else if (financeIssues > 0) {
      actions.push({
        id: "finance",
        title: `${fmtNumber(financeIssues)} finance signal${financeIssues === 1 ? "" : "s"} to review`,
        detail: "Failed payments, invoices, disputes or payouts",
        href: "#finance-operations",
        tone: "warning",
      });
    }
  }

  return (
    <section aria-label="What needs attention" className="scroll-mt-24">
      <GroupLabel
        action={
          <Chip tone={actions.length > 0 ? "warning" : "success"}>
            {actions.length > 0 ? `${actions.length} open` : "All clear"}
          </Chip>
        }
      >
        What needs attention
      </GroupLabel>
      {actions.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {actions.map((action) => (
            <Link
              key={action.id}
              href={action.href}
              className={cn(
                "group rounded-2xl border bg-card p-4 shadow-[var(--ds-shadow)] transition-colors hover:border-primary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                action.tone === "danger" && "border-destructive/25",
                action.tone === "warning" && "border-warning/25",
                action.tone === "primary" && "border-primary/20",
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
                    action.tone === "danger" && "bg-destructive/10 text-destructive",
                    action.tone === "warning" && "bg-warning/10 text-warning",
                    action.tone === "primary" && "bg-primary/10 text-primary",
                  )}
                >
                  <AlertTriangle className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[13px] font-semibold">{action.title}</h3>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                    {action.detail}
                  </p>
                  <p className="mt-3 text-[11.5px] font-medium text-primary">Review now →</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Tile className="flex flex-wrap items-center justify-between gap-3 border-success/20 bg-success/[0.035] p-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="size-4" />
            </span>
            <div>
              <h3 className="text-[13px] font-semibold">No immediate action required</h3>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Funding, billing, jobs and account health are within their current targets.
              </p>
            </div>
          </div>
          <Chip tone="success">Healthy</Chip>
        </Tile>
      )}
    </section>
  );
}

function OverviewJumpNav({ showFinancials }: { showFinancials: boolean }) {
  const links = [
    { href: "#business-health", label: "Business health" },
    { href: "#provider-funding", label: "Provider funding" },
    ...(showFinancials
      ? [
          { href: "#financials", label: "Financials" },
          { href: "#finance-operations", label: "Operations" },
        ]
      : []),
  ];

  return (
    <nav
      aria-label="Overview sections"
      className="mt-3 flex gap-1 overflow-x-auto rounded-2xl border border-border/60 bg-card p-1.5 shadow-[var(--ds-shadow)]"
    >
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="shrink-0 rounded-xl px-3 py-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

function DetailDisclosure({
  title,
  detail,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  detail: string;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="group overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[var(--ds-shadow)]"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 outline-none transition-colors hover:bg-[var(--ds-well-bg)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-[13px] font-semibold">{title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {count !== undefined && <Chip tone="neutral">{fmtNumber(count)}</Chip>}
          <span className="text-[16px] text-muted-foreground transition-transform group-open:rotate-45">
            +
          </span>
        </div>
      </summary>
      <div className="border-t border-border/60 p-2 sm:p-3">{children}</div>
    </details>
  );
}

function FundingDashboard({ data }: { data: AdminFundingOverview }) {
  const nothingToFund = data.accounts.length === 0;
  const statusCopy = nothingToFund
    ? "Nothing to fund yet"
    : data.status === "action_needed"
      ? `Add ${fmtUsd(data.calculation.verifiedTopUpUsd)} now`
      : data.status === "unverified"
        ? "Check provider balances"
        : "New paid plans are fully covered";

  return (
    <section id="provider-funding" className="scroll-mt-24">
      <GroupLabel>Credits to add</GroupLabel>
      <Tile
        className={cn(
          "mb-3 border p-4 sm:p-5",
          (nothingToFund || data.status === "healthy") && "border-success/25 bg-success/[0.045]",
          !nothingToFund &&
            data.status === "action_needed" &&
            "border-destructive/30 bg-destructive/[0.045]",
          !nothingToFund && data.status === "unverified" && "border-warning/30 bg-warning/[0.05]",
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-full",
              nothingToFund || data.status === "healthy"
                ? "bg-success/12 text-success"
                : data.status === "action_needed"
                  ? "bg-destructive/12 text-destructive"
                  : "bg-warning/12 text-warning",
            )}
          >
            {nothingToFund || data.status === "healthy" ? (
              <CheckCircle2 className="size-5" />
            ) : (
              <AlertTriangle className="size-5" />
            )}
          </span>
          <div>
            <h3 className="text-[16px] font-semibold">{statusCopy}</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
              Existing accounts and Free plans count as $0. Only successful paid-plan purchases or
              renewals recorded after {fmtDateTime(data.calculation.countingFrom)} are included.
            </p>
          </div>
        </div>
      </Tile>

      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Stat
          label="New paid plans counted"
          value={fmtNumber(data.accounts.length)}
          icon={Users}
          hint="Existing and Free accounts excluded"
        />
        <Stat
          label="Credits required"
          value={fmtUsd(data.calculation.totalReserveUsd)}
          icon={Gauge}
          hint="OpenRouter and KIE reserve"
        />
        <Stat
          label="Add now"
          value={fmtUsd(data.calculation.verifiedTopUpUsd)}
          icon={Wallet}
          tone={data.calculation.verifiedTopUpUsd > 0 ? "destructive" : "success"}
          hint={
            data.calculation.unverifiedProviders
              ? "Verify unavailable balance"
              : "After provider balances"
          }
        />
      </div>

      {data.accounts.length > 0 && (
        <div className="mb-3 grid gap-3 lg:grid-cols-2">
          {data.providers.map((item) => {
            const short = (item.shortfallUsd ?? 0) > 0;
            const verified = item.balanceUsd !== null;
            return (
              <Tile key={item.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-[14px] font-semibold">{item.label}</h4>
                      <Chip tone={!verified ? "warning" : short ? "danger" : "success"}>
                        {!verified ? "unverified" : short ? "top up" : "funded"}
                      </Chip>
                    </div>
                    <p className="mt-1 text-[11.5px] text-muted-foreground">{item.message}</p>
                  </div>
                  {(short || !verified) && (
                    <a
                      href={item.topUpUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
                    >
                      {short ? "Add credits" : "Open provider"} <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border/50 pt-3">
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
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Provider coverage</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {item.coveragePercent === null
                        ? "Balance unavailable"
                        : `${Math.min(100, item.coveragePercent).toFixed(0)}%`}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-foreground/[0.06]">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        !verified ? "bg-warning" : short ? "bg-destructive" : "bg-success",
                      )}
                      style={{
                        width: `${item.coveragePercent === null ? 0 : Math.min(100, item.coveragePercent)}%`,
                      }}
                    />
                  </div>
                </div>
              </Tile>
            );
          })}
        </div>
      )}

      {data.accounts.length > 0 && (
        <DetailDisclosure
          title="Customers included in the reserve"
          detail="Inspect each new paid plan and its remaining credits"
          count={data.accounts.length}
        >
          <TableFrame label="Paid plans counted for provider funding">
            <thead>
              <tr>
                <th className={th}>Customer</th>
                <th className={th}>Purchased</th>
                <th className={th}>Plan</th>
                <th className={th}>Credits remaining</th>
                <th className={`${th} text-right`}>Reserve</th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((account) => (
                <tr key={account.accountId} className={rowClass}>
                  <td className={td}>
                    <Link
                      href={`/admin/billing?account=${encodeURIComponent(account.accountId)}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {account.ownerEmail ?? `${account.accountId.slice(0, 8)}…`}
                    </Link>
                  </td>
                  <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                    {fmtDateTime(account.purchaseRecordedAt)}
                  </td>
                  <td className={`${td} font-medium`}>{account.planLabel}</td>
                  <td className={`${td} text-[12px] text-muted-foreground`}>
                    <span className="text-foreground">
                      {fmtNumber(account.meters.credits.available)}
                    </span>{" "}
                    general ·{" "}
                    <span className="text-foreground">
                      {formatVideoCredits(account.meters.video.available)}
                    </span>{" "}
                    VC ·{" "}
                    <span className="text-foreground">
                      {fmtNumber(account.meters.proMessages.available)}
                    </span>{" "}
                    Pro ·{" "}
                    <span className="text-foreground">
                      {fmtNumber(account.meters.flashMessages.available)}
                    </span>{" "}
                    Flash
                  </td>
                  <td className={`${td} text-right font-semibold tabular-nums`}>
                    {fmtUsd(account.reserve.totalUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </DetailDisclosure>
      )}
    </section>
  );
}

function RevenueChart({ data }: { data: Extract<AdminFinanceOverview, { configured: true }> }) {
  const rows = data.monthly.map((row) => ({
    month: row.month,
    received: row.receivedCents / 100,
    net: row.netRevenueCents / 100,
    sales: row.sales,
  }));
  const hasRevenue = rows.some((row) => row.received !== 0 || row.net !== 0);
  const totalReceived = data.monthly.reduce((total, row) => total + row.receivedCents, 0);
  const totalNet = data.monthly.reduce((total, row) => total + row.netRevenueCents, 0);
  const totalSales = data.monthly.reduce((total, row) => total + row.sales, 0);
  const strongestMonth = data.monthly.reduce<(typeof data.monthly)[number] | null>(
    (best, row) => (!best || row.receivedCents > best.receivedCents ? row : best),
    null,
  );

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
        <>
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
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-4">
            <div>
              <p className="text-[10.5px] text-muted-foreground">12-month gross</p>
              <p className="mt-1 text-[13px] font-semibold tabular-nums">
                {money(totalReceived, data.currency)}
              </p>
            </div>
            <div>
              <p className="text-[10.5px] text-muted-foreground">Net retained</p>
              <p className="mt-1 text-[13px] font-semibold tabular-nums">
                {totalReceived > 0 ? `${((totalNet / totalReceived) * 100).toFixed(1)}%` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[10.5px] text-muted-foreground">Best month</p>
              <p className="mt-1 text-[13px] font-semibold tabular-nums">
                {strongestMonth ? monthLabel(strongestMonth.month) : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {fmtNumber(totalSales)} total sales
              </p>
            </div>
          </div>
        </>
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

function CashPositionVisual({
  data,
}: {
  data: Extract<AdminFinanceOverview, { configured: true }>;
}) {
  const available = amountFor(data.balance.available, data.currency);
  const pending = amountFor(data.balance.pending, data.currency);
  const inTransit = data.payoutPipeline.inTransitCents;
  const total = Math.max(0, available) + Math.max(0, pending) + Math.max(0, inTransit);
  const rows = [
    { label: "Available now", value: available, tone: "success" as const },
    { label: "Pending in Stripe", value: pending, tone: "primary" as const },
    { label: "Payouts in transit", value: inTransit, tone: "warning" as const },
  ];

  return (
    <Tile className="h-full p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-[14px] font-semibold">Cash movement</h4>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Where accessible cash is right now
          </p>
        </div>
        <Wallet className="size-4 text-muted-foreground" />
      </div>
      <div className="mt-5 rounded-2xl bg-[var(--ds-well-bg)] p-4">
        <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          Tracked cash
        </p>
        <p className="mt-1.5 text-[25px] font-semibold tracking-[-0.025em] tabular-nums">
          {money(total, data.currency)}
        </p>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-foreground/[0.06]">
          {rows.map((row) => (
            <span
              key={row.label}
              className={cn(
                "h-full first:rounded-l-full last:rounded-r-full",
                row.tone === "success" && "bg-success",
                row.tone === "primary" && "bg-primary",
                row.tone === "warning" && "bg-warning",
              )}
              style={{ width: `${percent(Math.max(0, row.value), total)}%` }}
            />
          ))}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 text-[12px]">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span
                className={cn(
                  "size-2 rounded-full",
                  row.tone === "success" && "bg-success",
                  row.tone === "primary" && "bg-primary",
                  row.tone === "warning" && "bg-warning",
                )}
              />
              {row.label}
            </span>
            <span className="font-medium tabular-nums">{money(row.value, data.currency)}</span>
          </div>
        ))}
      </div>
    </Tile>
  );
}

function ProfitVisual({ data }: { data: Extract<AdminFinanceOverview, { configured: true }> }) {
  const gross = data.last30Days.receivedCents;
  const stripeCosts =
    data.last30Days.feesCents + data.last30Days.refundsCents + data.last30Days.disputesCents;
  const aiCostCents =
    data.last30Days.estimatedAiCostUsd === null
      ? null
      : Math.round(data.last30Days.estimatedAiCostUsd * 100);
  const max = Math.max(1, gross, data.last30Days.netRevenueCents, aiCostCents ?? 0);

  return (
    <Tile className="h-full p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-[14px] font-semibold">30-day profitability</h4>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Revenue after Stripe and measured AI usage
          </p>
        </div>
        <Chip
          tone={
            data.last30Days.marginPercent === null
              ? "neutral"
              : data.last30Days.marginPercent >= 60
                ? "success"
                : data.last30Days.marginPercent >= 0
                  ? "warning"
                  : "danger"
          }
        >
          {data.last30Days.marginPercent === null
            ? "Margin unavailable"
            : `${data.last30Days.marginPercent.toFixed(1)}% margin`}
        </Chip>
      </div>
      <div className="mt-5 space-y-4">
        <SignalBar
          label="Gross received"
          value={money(gross, data.currency)}
          detail={`${fmtNumber(data.last30Days.sales)} successful payments`}
          width={percent(gross, max)}
        />
        <SignalBar
          label="Stripe deductions"
          value={money(stripeCosts, data.currency)}
          detail="Fees, refunds and disputes"
          width={percent(stripeCosts, max)}
          tone={stripeCosts > 0 ? "warning" : "success"}
        />
        <SignalBar
          label="Net revenue"
          value={money(data.last30Days.netRevenueCents, data.currency)}
          detail="After Stripe activity"
          width={percent(data.last30Days.netRevenueCents, max)}
          tone="success"
        />
        <SignalBar
          label="Measured AI cost"
          value={aiCostCents === null ? "Unavailable" : money(aiCostCents, data.currency)}
          detail="OpenRouter and KIE usage"
          width={aiCostCents === null ? 0 : percent(aiCostCents, max)}
          tone="warning"
        />
      </div>
      <div className="mt-5 flex items-end justify-between gap-4 border-t border-border/60 pt-4">
        <div>
          <p className="text-[11px] text-muted-foreground">Estimated contribution profit</p>
          <p
            className={cn(
              "mt-1 text-[22px] font-semibold tabular-nums",
              (data.last30Days.estimatedProfitCents ?? 0) < 0 && "text-destructive",
            )}
          >
            {data.last30Days.estimatedProfitCents === null
              ? "—"
              : money(data.last30Days.estimatedProfitCents, data.currency)}
          </p>
        </div>
        <p className="max-w-48 text-right text-[10.5px] leading-relaxed text-muted-foreground">
          Before payroll, marketing, tax and other overhead.
        </p>
      </div>
    </Tile>
  );
}

function GrowthVisual({ data }: { data: Extract<AdminFinanceOverview, { configured: true }> }) {
  const lifecycleTotal = Math.max(
    1,
    data.recurring.active +
      data.recurring.trialing +
      data.recurring.pastDue +
      data.recurring.canceling,
  );
  return (
    <Tile className="h-full p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-[14px] font-semibold">Subscription momentum</h4>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Growth and retention over the last 30 days
          </p>
        </div>
        <Chip
          tone={
            data.recurring.churnPercent !== null && data.recurring.churnPercent > 7
              ? "warning"
              : "success"
          }
        >
          {data.recurring.churnPercent === null
            ? "No churn data"
            : `${data.recurring.churnPercent.toFixed(1)}% churn`}
        </Chip>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-primary/[0.055] p-4">
          <p className="text-[11px] text-muted-foreground">MRR</p>
          <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] tabular-nums">
            {money(data.recurring.mrrCents, data.currency)}
          </p>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            {money(data.recurring.arrCents, data.currency)} ARR
          </p>
        </div>
        <div className="rounded-2xl bg-success/[0.055] p-4">
          <p className="text-[11px] text-muted-foreground">Net adds</p>
          <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] tabular-nums">
            {fmtNumber(data.recurring.new30d - data.recurring.canceled30d)}
          </p>
          <p className="mt-1 text-[10.5px] text-muted-foreground">
            {fmtNumber(data.recurring.new30d)} new, {fmtNumber(data.recurring.canceled30d)} canceled
          </p>
        </div>
      </div>
      <div className="mt-5 space-y-4">
        <SignalBar
          label="Active"
          value={fmtNumber(data.recurring.active)}
          detail="Paying subscriptions"
          width={percent(data.recurring.active, lifecycleTotal)}
          tone="success"
        />
        <SignalBar
          label="Trialing"
          value={fmtNumber(data.recurring.trialing)}
          detail="Potential conversions"
          width={percent(data.recurring.trialing, lifecycleTotal)}
        />
        <SignalBar
          label="At risk"
          value={fmtNumber(
            data.recurring.pastDue +
              data.recurring.canceling +
              data.recurring.unpaid +
              data.recurring.incomplete,
          )}
          detail={`${fmtNumber(data.recurring.pastDue)} past due, ${fmtNumber(data.recurring.canceling)} canceling`}
          width={percent(data.recurring.pastDue + data.recurring.canceling, lifecycleTotal)}
          tone="warning"
        />
      </div>
    </Tile>
  );
}

function FinanceDashboard({ data }: { data: Extract<AdminFinanceOverview, { configured: true }> }) {
  const reserved = amountFor(data.balance.connectReserved, data.currency);
  const refundReserve =
    amountFor(data.balance.refundPrefundingAvailable, data.currency) +
    amountFor(data.balance.refundPrefundingPending, data.currency);
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
    <section id="financials" className="scroll-mt-24">
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

      <GroupLabel>Financial command center</GroupLabel>
      <div className="grid gap-3 xl:grid-cols-[1.65fr_1fr]">
        <RevenueChart data={data} />
        <CashPositionVisual data={data} />
      </div>

      <GroupLabel>Revenue pulse</GroupLabel>
      <PeriodSnapshot data={data} />

      <GroupLabel>Profitability & recurring growth</GroupLabel>
      <div className="grid gap-3 xl:grid-cols-2">
        <ProfitVisual data={data} />
        <GrowthVisual data={data} />
      </div>

      <GroupLabel>Customers & plan mix</GroupLabel>
      <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
        <PlanMix data={data} />
        <Tile className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-[14px] font-semibold">Customer picture</h4>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Acquisition, loyalty and billing risk
              </p>
            </div>
            <Users className="size-4 text-muted-foreground" />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-[var(--ds-well-bg)] p-4">
              <p className="text-[11px] text-muted-foreground">Stripe customers</p>
              <p className="mt-1 text-[21px] font-semibold tabular-nums">
                {fmtNumber(data.customers.total)}
              </p>
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                +{fmtNumber(data.customers.new30d)} in 30 days
              </p>
            </div>
            <div className="rounded-2xl bg-[var(--ds-well-bg)] p-4">
              <p className="text-[11px] text-muted-foreground">Repeat buyers</p>
              <p className="mt-1 text-[21px] font-semibold tabular-nums">
                {fmtNumber(data.customers.repeatBuyers30d)}
              </p>
              <p className="mt-1 text-[10.5px] text-muted-foreground">2+ paid invoices</p>
            </div>
          </div>
          <div className="mt-5 space-y-4">
            <SignalBar
              label="Payment success"
              value={
                data.payments.successRatePercent === null
                  ? "No attempts"
                  : `${data.payments.successRatePercent.toFixed(1)}%`
              }
              detail={`${fmtNumber(data.payments.succeeded30d)} succeeded, ${fmtNumber(data.payments.failed30d)} failed`}
              width={data.payments.successRatePercent ?? 0}
              tone={(data.payments.successRatePercent ?? 100) >= 90 ? "success" : "warning"}
            />
            <SignalBar
              label="Invoice collection"
              value={
                data.invoices.collectionRatePercent === null
                  ? "No invoices"
                  : `${data.invoices.collectionRatePercent.toFixed(1)}%`
              }
              detail={`${fmtNumber(data.invoices.paid30d)} paid, ${fmtNumber(data.invoices.overdue)} overdue`}
              width={data.invoices.collectionRatePercent ?? 0}
              tone={data.invoices.overdue > 0 ? "warning" : "success"}
            />
          </div>
        </Tile>
      </div>

      <GroupLabel
        action={
          <Link href="/admin/billing" className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}>
            Open billing accounts
          </Link>
        }
      >
        Detailed financial records
      </GroupLabel>
      <div className="space-y-3">
        <DetailDisclosure
          title="Recent plan sales"
          detail="Customers, plans and received amounts"
          count={data.recentSales.length}
        >
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
            <p className="px-3 py-4 text-[12px] text-muted-foreground">
              No paid Stripe invoices yet.
            </p>
          )}
        </DetailDisclosure>

        {data.customers.top30d.length > 0 && (
          <DetailDisclosure
            title="Top customers"
            detail="Highest collected revenue in the last 30 days"
            count={data.customers.top30d.length}
          >
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
          </DetailDisclosure>
        )}
      </div>

      <div id="finance-operations" className="scroll-mt-24">
        <GroupLabel>Payments & collections</GroupLabel>
        <PaymentIntelligence data={data} />
      </div>

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
      <DetailDisclosure
        title="Recent payouts"
        detail="Stripe payout status, method and expected arrival"
        count={data.recentPayouts.length}
      >
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
                    <Chip tone={statusTone(payout.status)}>
                      {payout.status.replaceAll("_", " ")}
                    </Chip>
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
          <p className="px-3 py-4 text-[12px] text-muted-foreground">
            No Stripe payouts in 30 days.
          </p>
        )}
      </DetailDisclosure>

      <GroupLabel>Exceptions requiring attention</GroupLabel>
      <RiskActivity data={data} />
    </section>
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
          aria-label={
            overview.isFetching || finance.isFetching ? "Refreshing overview" : "Refresh overview"
          }
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
          {overview.isFetching || finance.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      {overview.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-64 rounded-2xl" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-24 rounded-2xl" />
            ))}
          </div>
        </div>
      )}
      {overview.error && (
        <LoadError error={overview.error} onRetry={() => void overview.refetch()} />
      )}
      {data && (
        <>
          <OverviewJumpNav showFinancials={financial?.configured === true} />
          <CompanyPulse
            data={data}
            canOpenBilling={me.data?.billing === true}
            onOpenBilling={() => router.push("/admin/billing")}
          />
          <ActionCenter
            data={data}
            finance={financial?.configured === true ? financial : undefined}
            canOpenBilling={me.data?.billing === true}
          />
        </>
      )}

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
    </SurfacePage>
  );
}
