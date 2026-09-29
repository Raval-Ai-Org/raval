"use client";

// Mellox admin console: approve "Upgrade now" requests, find an account,
// activate a plan or pack paid offline, add or correct balances, and watch
// billing health. Every action is checked and recorded on the server.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  SurfaceLayout,
  SurfacePage,
  Tile,
  GroupLabel,
  Stat,
} from "@/components/app/surface/SurfaceLayout";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, ArrowLeft, Inbox, Search, Shield, Users, Wallet } from "@/components/icons";
import { authedFetch } from "@/lib/authed-fetch";
import {
  CREDIT_PACKS,
  PLANS,
  VIDEO_PACKS,
  type BillingInterval,
  type PaidPlanId,
} from "@/lib/billing/catalog";
import { formatMeter, formatNumber, formatUsd, ledgerLabel } from "@/lib/billing/present";
import { GhostButton, PrimaryButton } from "@/components/app/billing/billing-ui";
import { cn } from "@/lib/utils";

type Tab = "requests" | "accounts" | "health";

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await authedFetch(path, {
    method: init?.method ?? "GET",
    ...(init?.body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) }
      : {}),
    workspaceId: null,
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = new Error(String(body.error ?? body.message ?? "Request failed.")) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }
  return body as T;
}

const field =
  "h-9 w-full rounded-full bg-[var(--ds-well-bg)] px-3.5 text-[13px] outline-none ring-primary/40 placeholder:text-muted-foreground focus-visible:ring-2";

function itemLabel(kind: string, key: string, interval?: string | null): string {
  if (kind === "plan" && key in PLANS) {
    return `${PLANS[key as PaidPlanId].label} plan · ${interval === "year" ? "yearly" : "monthly"}`;
  }
  const credit = CREDIT_PACKS.find((pack) => pack.key === key);
  if (credit)
    return `Credit pack · ${formatMeter("credits", credit.credits + credit.bonusCredits)}`;
  const video = VIDEO_PACKS.find((pack) => pack.key === key);
  if (video) return `Video pack · ${formatMeter("video", video.videoUnits)}`;
  return key;
}

export function BillingAdmin() {
  const [tab, setTab] = useState<Tab>("requests");
  const [accountId, setAccountId] = useState<string | null>(null);
  const check = useQuery({
    queryKey: ["admin", "billing", "access"],
    queryFn: () => api<{ report: Record<string, unknown> }>("/api/admin/billing"),
    retry: false,
  });
  const denied = (check.error as (Error & { status?: number }) | null)?.status === 403;
  const pending = useQuery({
    queryKey: ["admin", "billing", "requests", "pending"],
    queryFn: () => api<{ requests: AdminRequest[] }>("/api/admin/billing/requests?status=pending"),
    enabled: check.isSuccess,
  });

  const nav = [
    {
      id: "requests" as const,
      label: "Requests",
      icon: Inbox,
      count: pending.data?.requests.length,
      highlight: true,
    },
    { id: "accounts" as const, label: "Accounts", icon: Users },
    { id: "health" as const, label: "Health", icon: Activity },
  ];

  return (
    <div data-mellox-app className="flex h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-primary">
            <Shield className="h-4 w-4" />
          </span>
          <h1 className="text-[15px] font-semibold">Mellox admin</h1>
        </div>
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to app
        </Link>
      </header>
      <div className="min-h-0 flex-1">
        {check.isLoading ? (
          <div className="mx-auto max-w-3xl space-y-3 p-6">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-48 rounded-2xl" />
          </div>
        ) : denied ? (
          <div className="grid h-full place-items-center p-6">
            <EmptyState
              icon={Shield}
              title="Admins only"
              description="Your account isn't on the Mellox admin list."
            />
          </div>
        ) : check.error ? (
          <div className="grid h-full place-items-center p-6">
            <ErrorState
              title="Admin console isn't available"
              description={check.error.message}
              onRetry={() => void check.refetch()}
            />
          </div>
        ) : (
          <SurfaceLayout
            items={nav}
            value={tab}
            onChange={(next) => {
              setTab(next);
              if (next !== "accounts") setAccountId(null);
            }}
            label="Admin sections"
          >
            {tab === "requests" && (
              <RequestsPage
                openAccount={(id) => {
                  setAccountId(id);
                  setTab("accounts");
                }}
              />
            )}
            {tab === "accounts" &&
              (accountId ? (
                <AccountPage id={accountId} back={() => setAccountId(null)} />
              ) : (
                <AccountsPage open={setAccountId} />
              ))}
            {tab === "health" && <HealthPage report={check.data?.report ?? {}} />}
          </SurfaceLayout>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Requests ───────────────────────────── */

type AdminRequest = {
  id: string;
  accountId: string;
  email: string | null;
  kind: string;
  key: string;
  interval: string | null;
  priceUsd: number | null;
  contact: string | null;
  note: string | null;
  status: string;
  adminNote: string | null;
  createdAt: string;
  handledAt: string | null;
};

function RequestsPage({ openAccount }: { openAccount: (id: string) => void }) {
  const [status, setStatus] = useState<"pending" | "all">("pending");
  const requests = useQuery({
    queryKey: ["admin", "billing", "requests", status],
    queryFn: () =>
      api<{ requests: AdminRequest[] }>(`/api/admin/billing/requests?status=${status}`),
  });
  return (
    <SurfacePage
      title="Upgrade requests"
      subtitle="People who clicked Upgrade now or asked for a pack"
      actions={
        <div className="inline-flex rounded-full bg-[var(--ds-well-bg)] p-1 text-[12.5px]">
          {(["pending", "all"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setStatus(option)}
              className={cn(
                "h-7 rounded-full px-3 font-medium",
                status === option ? "bg-background shadow-sm" : "text-muted-foreground",
              )}
            >
              {option === "pending" ? "Waiting" : "All"}
            </button>
          ))}
        </div>
      }
    >
      {requests.isLoading && <Skeleton className="h-40 rounded-2xl" />}
      {requests.error && (
        <ErrorState description={requests.error.message} onRetry={() => void requests.refetch()} />
      )}
      {requests.data?.requests.length === 0 && (
        <EmptyState icon={Inbox} title="No requests waiting" description="New ones show up here." />
      )}
      <div className="space-y-3">
        {requests.data?.requests.map((request) => (
          <RequestRow key={request.id} request={request} openAccount={openAccount} />
        ))}
      </div>
    </SurfacePage>
  );
}

function RequestRow({
  request,
  openAccount,
}: {
  request: AdminRequest;
  openAccount: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"idle" | "approve" | "decline">("idle");
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [months, setMonths] = useState(request.interval === "year" ? 12 : 1);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    try {
      if (request.kind === "plan") {
        await api("/api/admin/billing/manage", {
          method: "POST",
          body: {
            op: "activate_plan",
            operationId,
            accountId: request.accountId,
            plan: request.key,
            interval: request.interval ?? "month",
            months,
            reason: "Paid offline (upgrade request)",
            reference: reference || undefined,
            requestId: request.id,
          },
        });
      } else {
        await api("/api/admin/billing/manage", {
          method: "POST",
          body: {
            op: "grant_pack",
            operationId,
            accountId: request.accountId,
            kind: request.kind,
            key: request.key,
            reason: "Paid offline (pack request)",
            reference: reference || undefined,
            requestId: request.id,
          },
        });
      }
      toast.success("Activated.");
      setOperationId(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ["admin", "billing"] });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not activate.");
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    try {
      await api("/api/admin/billing/manage", {
        method: "POST",
        body: { op: "decline_request", requestId: request.id, note: note || undefined },
      });
      toast.success("Declined.");
      await queryClient.invalidateQueries({ queryKey: ["admin", "billing"] });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not decline.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tile className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 text-[13px]">
          <p className="text-[14px] font-semibold">
            {itemLabel(request.kind, request.key, request.interval)}
            {request.priceUsd !== null && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {formatUsd(request.priceUsd)}
              </span>
            )}
          </p>
          <p className="text-muted-foreground">
            <button
              type="button"
              className="underline-offset-4 hover:text-foreground hover:underline"
              onClick={() => openAccount(request.accountId)}
            >
              {request.email ?? request.accountId}
            </button>
            {request.contact && ` · ${request.contact}`} ·{" "}
            {new Date(request.createdAt).toLocaleString()}
          </p>
          {request.note && <p className="mt-1">“{request.note}”</p>}
        </div>
        {request.status === "pending" ? (
          <div className="flex gap-2">
            <PrimaryButton className="h-9" onClick={() => setMode("approve")}>
              Activate
            </PrimaryButton>
            <GhostButton className="h-9" onClick={() => setMode("decline")}>
              Decline
            </GhostButton>
          </div>
        ) : (
          <span className="rounded-full bg-[var(--ds-well-bg)] px-2.5 py-1 text-[12px] capitalize">
            {request.status}
          </span>
        )}
      </div>
      {mode === "approve" && request.status === "pending" && (
        <div className="grid gap-2 rounded-[var(--ds-radius-well)] bg-[var(--ds-well-bg)] p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
          {request.kind === "plan" ? (
            <label className="flex items-center gap-2 text-[13px]">
              Months
              <input
                type="number"
                min={1}
                max={36}
                value={months}
                onChange={(event) =>
                  setMonths(Math.max(1, Math.min(36, Number(event.target.value))))
                }
                className={cn(field, "w-20 bg-background")}
              />
            </label>
          ) : (
            <span />
          )}
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Payment reference (bank, JazzCash, invoice…)"
            className={cn(field, "bg-background")}
          />
          <PrimaryButton className="h-9" disabled={busy} onClick={() => void approve()}>
            {busy ? "Working…" : "Confirm payment received"}
          </PrimaryButton>
        </div>
      )}
      {mode === "decline" && request.status === "pending" && (
        <div className="flex flex-col gap-2 rounded-[var(--ds-radius-well)] bg-[var(--ds-well-bg)] p-3 sm:flex-row">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note (optional)"
            className={cn(field, "bg-background")}
          />
          <GhostButton className="h-9" disabled={busy} onClick={() => void decline()}>
            Decline request
          </GhostButton>
        </div>
      )}
    </Tile>
  );
}

/* ───────────────────────────── Accounts ───────────────────────────── */

type AccountSummary = {
  id: string;
  ownerUserId: string;
  email: string | null;
  plan: string;
  status: string;
  manualUntil: string | null;
  interval: string | null;
  provider: string | null;
  brands: number;
  createdAt: string;
};

function planName(plan: string) {
  return plan in PLANS ? PLANS[plan as PaidPlanId].label : plan;
}

function AccountsPage({ open }: { open: (id: string) => void }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);
  const accounts = useQuery({
    queryKey: ["admin", "billing", "accounts", query],
    queryFn: () =>
      api<{ accounts: AccountSummary[] }>(
        `/api/admin/billing/accounts${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      ),
  });
  return (
    <SurfacePage title="Accounts">
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Search by email, brand name, website or id"
          aria-label="Search accounts"
          className={cn(field, "h-10 pl-10")}
        />
      </div>
      {accounts.isLoading && <Skeleton className="h-48 rounded-2xl" />}
      {accounts.error && (
        <ErrorState description={accounts.error.message} onRetry={() => void accounts.refetch()} />
      )}
      {accounts.data?.accounts.length === 0 && (
        <EmptyState icon={Search} title="No accounts found" />
      )}
      {!!accounts.data?.accounts.length && (
        <Tile className="divide-y divide-border/50 p-0 sm:p-0">
          {accounts.data.accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => open(account.id)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13px] transition-colors hover:bg-[var(--ds-well-bg)]"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{account.email ?? account.id}</span>
                <span className="text-muted-foreground">
                  {account.brands} {account.brands === 1 ? "brand" : "brands"} · joined{" "}
                  {new Date(account.createdAt).toLocaleDateString()}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-semibold">{planName(account.plan)}</span>
                <span className="text-[12px] text-muted-foreground">
                  {account.manualUntil
                    ? `until ${new Date(account.manualUntil).toLocaleDateString()}`
                    : account.status}
                </span>
              </span>
            </button>
          ))}
        </Tile>
      )}
    </SurfacePage>
  );
}

type AccountDetail = AccountSummary & {
  enforcementOverride: string | null;
  periodEnd: string | null;
  nextGrantAt: string | null;
  wallet: Record<string, { available: number; held: number; debt: number }> | null;
  brands: Array<{ id: string; name: string; domain: string | null; frozen_at: string | null }>;
  ledger: Array<{
    id: number;
    meter: string;
    kind: string;
    delta_available: number;
    action: string | null;
    reason: string | null;
    created_at: string;
  }>;
  grants: Array<{
    id: string;
    meter: string;
    source: string;
    restriction: string;
    amount: number;
    remaining: number;
    expires_at: string | null;
  }>;
  activations: Array<{
    id: string;
    kind: string;
    catalog_key: string;
    billing_interval: string | null;
    months: number | null;
    active_until: string | null;
    reference: string | null;
    reason: string;
    created_at: string;
  }>;
};

function AccountPage({ id, back }: { id: string; back: () => void }) {
  const detail = useQuery({
    queryKey: ["admin", "billing", "account", id],
    queryFn: () => api<{ account: AccountDetail }>(`/api/admin/billing/accounts?id=${id}`),
  });
  const account = detail.data?.account;
  return (
    <SurfacePage
      title={account?.email ?? "Account"}
      subtitle={account ? `Account ${account.id}` : undefined}
      actions={<GhostButton onClick={back}>All accounts</GhostButton>}
    >
      {detail.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {detail.error && (
        <ErrorState description={detail.error.message} onRetry={() => void detail.refetch()} />
      )}
      {account && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat
              label="Plan"
              icon={Wallet}
              value={planName(account.plan)}
              tone="primary"
              hint={
                account.manualUntil
                  ? `Manual until ${new Date(account.manualUntil).toLocaleDateString()}`
                  : account.status
              }
            />
            <Stat
              label="Credits"
              value={formatNumber(account.wallet?.credits?.available ?? 0)}
              hint={
                account.wallet?.credits?.held
                  ? `${formatNumber(account.wallet.credits.held)} held`
                  : undefined
              }
            />
            <Stat
              label="Videos"
              value={formatMeter("video", account.wallet?.video?.available ?? 0)}
            />
            <Stat
              label="Pro / chat messages"
              value={`${formatNumber(account.wallet?.pro_messages?.available ?? 0)} / ${formatNumber(account.wallet?.flash_messages?.available ?? 0)}`}
            />
          </div>

          <GroupLabel>Actions</GroupLabel>
          <div className="grid gap-3 lg:grid-cols-2">
            <ActivatePlanForm account={account} />
            <GrantPackForm account={account} />
            <AdjustForm account={account} />
            <EnforcementForm account={account} />
          </div>

          <GroupLabel>Brands</GroupLabel>
          <Tile className="divide-y divide-border/50 p-0 sm:p-0">
            {account.brands.map((brand) => (
              <div key={brand.id} className="flex justify-between gap-3 px-4 py-2.5 text-[13px]">
                <span className="font-medium">{brand.name}</span>
                <span className="text-muted-foreground">
                  {brand.domain ?? ""} {brand.frozen_at ? "· paused" : ""}
                </span>
              </div>
            ))}
            {account.brands.length === 0 && (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">No brands yet.</p>
            )}
          </Tile>

          {account.activations.length > 0 && (
            <>
              <GroupLabel>Manual activations</GroupLabel>
              <Tile className="divide-y divide-border/50 p-0 sm:p-0">
                {account.activations.map((row) => (
                  <div key={row.id} className="px-4 py-2.5 text-[13px]">
                    <span className="font-medium">
                      {row.kind === "end_plan"
                        ? `Ended ${planName(row.catalog_key)}`
                        : itemLabel(row.kind, row.catalog_key, row.billing_interval)}
                    </span>
                    <span className="text-muted-foreground">
                      {row.months ? ` · ${row.months} mo` : ""}
                      {row.reference ? ` · ${row.reference}` : ""} ·{" "}
                      {new Date(row.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </Tile>
            </>
          )}

          <GroupLabel>Balance history</GroupLabel>
          <Tile className="max-h-80 divide-y divide-border/50 overflow-y-auto p-0 sm:p-0">
            {account.ledger.map((row) => (
              <div key={row.id} className="flex justify-between gap-3 px-4 py-2 text-[12.5px]">
                <span>
                  <span className="font-medium">{ledgerLabel(row)}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {row.kind} · {new Date(row.created_at).toLocaleString()}
                  </span>
                </span>
                <span className="tabular-nums">
                  {row.delta_available > 0 ? "+" : ""}
                  {formatMeter(row.meter, row.delta_available)}
                </span>
              </div>
            ))}
            {account.ledger.length === 0 && (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">No activity yet.</p>
            )}
          </Tile>
        </>
      )}
    </SurfacePage>
  );
}

function FormTile({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Tile className="space-y-3">
      <p className="text-[14px] font-semibold">{title}</p>
      {children}
    </Tile>
  );
}

function useAdminAction(accountId: string) {
  const queryClient = useQueryClient();
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  async function run(body: Record<string, unknown>, path = "/api/admin/billing/manage") {
    setBusy(true);
    try {
      await api(path, { method: "POST", body });
      toast.success("Done.");
      setOperationId(crypto.randomUUID());
      await queryClient.invalidateQueries({ queryKey: ["admin", "billing"] });
      return true;
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "That didn't work.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { operationId, busy, run, accountId };
}

function ActivatePlanForm({ account }: { account: AccountDetail }) {
  const action = useAdminAction(account.id);
  const [plan, setPlan] = useState<PaidPlanId>("starter");
  const [interval, setBillingInterval] = useState<BillingInterval>("month");
  const [months, setMonths] = useState(1);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("Paid offline");
  return (
    <FormTile title="Activate a plan">
      <div className="grid grid-cols-3 gap-2">
        <select
          value={plan}
          onChange={(event) => setPlan(event.target.value as PaidPlanId)}
          className={field}
          aria-label="Plan"
        >
          {(["starter", "growth", "agency", "scale"] as const).map((id) => (
            <option key={id} value={id}>
              {PLANS[id].label}
            </option>
          ))}
        </select>
        <select
          value={interval}
          onChange={(event) => {
            const next = event.target.value as BillingInterval;
            setBillingInterval(next);
            setMonths(next === "year" ? 12 : 1);
          }}
          className={field}
          aria-label="Billing"
        >
          <option value="month">Monthly</option>
          <option value="year">Yearly</option>
        </select>
        <input
          type="number"
          min={1}
          max={36}
          value={months}
          onChange={(event) => setMonths(Math.max(1, Math.min(36, Number(event.target.value))))}
          className={field}
          aria-label="Months"
        />
      </div>
      <input
        value={reference}
        onChange={(event) => setReference(event.target.value)}
        placeholder="Payment reference (optional)"
        className={field}
      />
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Reason"
        className={field}
      />
      <div className="flex flex-wrap gap-2">
        <PrimaryButton
          className="h-9"
          disabled={action.busy || reason.trim().length < 3}
          onClick={() =>
            void action.run({
              op: "activate_plan",
              operationId: action.operationId,
              accountId: account.id,
              plan,
              interval,
              months,
              reason,
              reference: reference || undefined,
            })
          }
        >
          Activate {PLANS[plan].label} for {months} {months === 1 ? "month" : "months"}
        </PrimaryButton>
        {account.manualUntil && (
          <GhostButton
            className="h-9"
            disabled={action.busy}
            onClick={() =>
              void action.run({
                op: "end_plan",
                operationId: action.operationId,
                accountId: account.id,
                reason: reason || "Ended by admin",
              })
            }
          >
            End manual plan
          </GhostButton>
        )}
      </div>
    </FormTile>
  );
}

function GrantPackForm({ account }: { account: AccountDetail }) {
  const action = useAdminAction(account.id);
  const packs = useMemo(
    () => [
      ...CREDIT_PACKS.map((pack) => ({ kind: "credit_pack", key: pack.key, usd: pack.usd })),
      ...VIDEO_PACKS.map((pack) => ({ kind: "video_pack", key: pack.key, usd: pack.usd })),
    ],
    [],
  );
  const [key, setKey] = useState(packs[0].key);
  const [reference, setReference] = useState("");
  const pack = packs.find((item) => item.key === key)!;
  return (
    <FormTile title="Add a paid pack">
      <select
        value={key}
        onChange={(event) => setKey(event.target.value)}
        className={field}
        aria-label="Pack"
      >
        {packs.map((item) => (
          <option key={item.key} value={item.key}>
            {itemLabel(item.kind, item.key)} · {formatUsd(item.usd)}
          </option>
        ))}
      </select>
      <input
        value={reference}
        onChange={(event) => setReference(event.target.value)}
        placeholder="Payment reference (optional)"
        className={field}
      />
      <PrimaryButton
        className="h-9"
        disabled={action.busy}
        onClick={() =>
          void action.run({
            op: "grant_pack",
            operationId: action.operationId,
            accountId: account.id,
            kind: pack.kind,
            key: pack.key,
            reason: "Paid offline",
            reference: reference || undefined,
          })
        }
      >
        Add pack
      </PrimaryButton>
    </FormTile>
  );
}

function AdjustForm({ account }: { account: AccountDetail }) {
  const action = useAdminAction(account.id);
  const [meter, setMeter] = useState<"credits" | "video" | "pro_messages" | "flash_messages">(
    "credits",
  );
  const [amount, setAmount] = useState(100);
  const [reason, setReason] = useState("");
  const units = meter === "video" ? amount * 100 : amount;
  return (
    <FormTile title="Give free credits">
      <div className="grid grid-cols-2 gap-2">
        <select
          value={meter}
          onChange={(event) => setMeter(event.target.value as typeof meter)}
          className={field}
          aria-label="Balance"
        >
          <option value="credits">Credits</option>
          <option value="video">Videos</option>
          <option value="pro_messages">Pro messages</option>
          <option value="flash_messages">Chat messages</option>
        </select>
        <input
          type="number"
          min={1}
          value={amount}
          onChange={(event) => setAmount(Math.max(1, Number(event.target.value)))}
          className={field}
          aria-label="Amount"
        />
      </div>
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why (at least 20 characters, kept in the audit log)"
        className={field}
      />
      <PrimaryButton
        className="h-9"
        disabled={action.busy || reason.trim().length < 20}
        onClick={() =>
          void action.run(
            {
              id: action.operationId,
              accountId: account.id,
              operation: "grant",
              meter,
              amount: units,
              reason,
            },
            "/api/admin/billing",
          )
        }
      >
        Give {formatMeter(meter, units)}
      </PrimaryButton>
      <p className="text-[12px] text-muted-foreground">
        Free credits work for AI only, never for backlinks.
      </p>
    </FormTile>
  );
}

function EnforcementForm({ account }: { account: AccountDetail }) {
  const action = useAdminAction(account.id);
  const [mode, setMode] = useState<string>(account.enforcementOverride ?? "default");
  const [reason, setReason] = useState("");
  return (
    <FormTile title="Limits for this account">
      <select
        value={mode}
        onChange={(event) => setMode(event.target.value)}
        className={field}
        aria-label="Enforcement"
      >
        <option value="default">Same as everyone (global setting)</option>
        <option value="off">Off · no limits or charges</option>
        <option value="shadow">Watch only · log what would be charged</option>
        <option value="on">On · charge and enforce limits</option>
      </select>
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why (at least 20 characters)"
        className={field}
      />
      <GhostButton
        className="h-9"
        disabled={action.busy || reason.trim().length < 20}
        onClick={() =>
          void action.run(
            {
              id: action.operationId,
              accountId: account.id,
              mode: mode === "default" ? null : mode,
              reason,
            },
            "/api/admin/billing/enforcement",
          )
        }
      >
        Save
      </GhostButton>
    </FormTile>
  );
}

/* ────────────────────────────── Health ────────────────────────────── */

const HEALTH_LABELS: Record<string, string> = {
  accounts: "Accounts",
  enforcement_on: "Accounts with limits on",
  shadow_denials_7d: "Would-block events, 7 days",
  failed_webhooks: "Failed payment webhooks",
  unprocessed_webhooks: "Webhooks waiting",
  frozen_brands: "Paused brands",
  suspended_seats: "Suspended seats",
  debt_accounts: "Accounts in debt",
  expired_holds: "Stuck holds",
  paid_cents: "Card payments",
  refunded_cents: "Refunded",
};

function HealthPage({ report }: { report: Record<string, unknown> }) {
  const entries = Object.entries(HEALTH_LABELS).filter(([key]) => key in report);
  return (
    <SurfacePage title="Health">
      <div className="grid gap-3 sm:grid-cols-3">
        {entries.map(([key, label]) => {
          const raw = Number(report[key] ?? 0);
          const value = key.endsWith("_cents") ? formatUsd(raw / 100) : formatNumber(raw);
          const bad =
            ["failed_webhooks", "debt_accounts", "expired_holds"].includes(key) && raw > 0;
          return <Stat key={key} label={label} value={value} tone={bad ? "warning" : "default"} />;
        })}
      </div>
      <p className="mt-4 text-[12.5px] text-muted-foreground">
        Global limits mode: set <code>BILLING_ENFORCEMENT</code> to off, shadow or on. Admins:{" "}
        <code>BILLING_ADMIN_USER_IDS</code>.
      </p>
    </SurfacePage>
  );
}
