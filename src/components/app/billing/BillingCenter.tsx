"use client";

// Plan & billing: one short page. Your plan and its Upgrade button, what is
// left this month, and recent activity. Choosing a plan or buying credits
// happens in the upgrade screen (UpgradeDialog), the same one used everywhere.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { AppModalShell } from "@/components/app/AppModalShell";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Crown, Lock, Wallet } from "@/components/icons";
import { emitAppEvent, onAppEvent } from "@/lib/app-events";
import { authedFetch } from "@/lib/authed-fetch";
import {
  CREDIT_PACKS,
  FEATURES,
  PLANS,
  SIGNUP_GRANT,
  VIDEO_PACKS,
  type PlanId,
} from "@/lib/billing/catalog";
import {
  asPlan,
  formatMeter,
  formatNumber,
  formatVideos,
  ledgerLabel,
  nextPlan,
} from "@/lib/billing/present";
import { useEntitlements, type BillingView } from "@/lib/billing/use-entitlements";
import { cn } from "@/lib/utils";
import { GhostButton, PrimaryButton, UsageBar } from "./billing-ui";
import { LockedFeatures } from "./FreePlanPushes";

async function getJson<T>(path: string, workspaceId?: string | null): Promise<T> {
  const response = await authedFetch(path, workspaceId ? { workspaceId } : undefined);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? body.message ?? "Could not load this."));
  return body as T;
}

async function send(path: string, body?: unknown, method = "POST") {
  const response = await authedFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(result.message ?? result.error ?? "Try again."));
  return result;
}

/** "4,210 of 6,000 left", or "7,300 left" when top-ups put it above the allowance. */
const ofTotal = (left: string, total: string, withinAllowance: boolean) =>
  withinAllowance ? `${left} of ${total} left` : `${left} left`;

const day = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function statusLine(data: BillingView): string {
  if (data.manual) return `Active until ${day(data.manual.until)}`;
  switch (data.status) {
    case "trialing":
      return data.trial.endsAt ? `Free trial until ${day(data.trial.endsAt)}` : "Free trial";
    case "active":
      return data.period.end ? `Renews ${day(data.period.end)}` : "Active";
    case "past_due":
      return "Payment failed";
    case "paused":
      return "Paused";
    case "canceled":
      return "Canceled";
    default:
      return "Upgrade for monthly credits, video and more";
  }
}

export function BillingCenter() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error, refetch } = useEntitlements({ enabled: open });

  useEffect(() => onAppEvent("open:usage", () => setOpen(true)), []);

  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      title="Plan & billing"
      Icon={Wallet}
      size="md"
    >
      <div className="space-y-7 px-5 pb-6 pt-2 sm:px-6">
        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        )}
        {error && !data && (
          <ErrorState
            title="Plan & billing isn't available"
            description={error.message}
            onRetry={() => void refetch()}
          />
        )}
        {data && <Overview data={data} onDone={() => setOpen(false)} />}
      </div>
    </AppModalShell>
  );
}

type PurchaseRequestRow = {
  id: string;
  kind: string;
  catalogKey: string;
  interval: string | null;
  status: string;
};

type TeamRequest = {
  id: string;
  brand: string;
  requester: string;
  feature: string;
  requiredPlan: string | null;
};

function requestLabel(row: PurchaseRequestRow) {
  if (row.kind === "plan" && row.catalogKey in PLANS) {
    return `${PLANS[row.catalogKey as PlanId].label} plan`;
  }
  const credit = CREDIT_PACKS.find((pack) => pack.key === row.catalogKey);
  if (credit) return `${formatMeter("credits", credit.credits + credit.bonusCredits)} pack`;
  const video = VIDEO_PACKS.find((pack) => pack.key === row.catalogKey);
  if (video) return `${formatMeter("video", video.videoUnits)} pack`;
  return "Your request";
}

function Overview({ data, onDone }: { data: BillingView; onDone: () => void }) {
  const queryClient = useQueryClient();
  const current = asPlan(data.entitledPlan);
  const plan = PLANS[current];
  const upgradeTo = nextPlan(current);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const requests = useQuery({
    queryKey: ["billing", "requests", data.accountId ?? "member"],
    queryFn: () => getJson<{ requests: PurchaseRequestRow[] }>("/api/billing/requests"),
    enabled: data.isOwner,
  });
  const team = useQuery({
    queryKey: ["billing", "team-requests", data.accountId ?? "member"],
    queryFn: () => getJson<{ requests: TeamRequest[] }>("/api/billing/upgrade-requests"),
    enabled: data.isOwner,
  });
  const brands = useQuery({
    queryKey: ["billing", "brands", data.accountId ?? "member", data.usage.brands],
    queryFn: () =>
      getJson<{ brands: Array<{ id: string; name: string; frozen_at: string | null }> }>(
        "/api/billing/brands",
      ),
    enabled: data.isOwner,
  });
  const pending = (requests.data?.requests ?? []).filter((row) => row.status === "pending");
  const paused = (brands.data?.brands ?? []).filter((brand) => brand.frozen_at);
  const cardSubscriber =
    data.isOwner &&
    data.checkoutMode === "card" &&
    !data.manual &&
    ["active", "past_due", "trialing", "paused"].includes(data.status);

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    try {
      await work();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Try again.");
    } finally {
      setBusy(null);
    }
  }

  const openUpgrade = (credits = false) => {
    onDone();
    emitAppEvent(
      "open:upgrade",
      credits ? { code: "insufficient_balance", meter: "credits" } : undefined,
    );
  };

  // Free credits are a one-time signup grant, so size the bar to it.
  const creditTotal = current === "free" ? SIGNUP_GRANT.credits : plan.allowances.credits;
  const resets = data.period.nextGrantAt ? `Resets ${day(data.period.nextGrantAt)}` : null;

  return (
    <>
      {/* Your plan */}
      <section className="ds-tile flex flex-col gap-5 bg-gradient-to-br from-primary/[0.09] via-transparent to-transparent p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
            <Crown className="h-5 w-5" />
          </span>
          <div className="space-y-0.5">
            <p className="text-[19px] font-semibold tracking-tight">{plan.label} plan</p>
            <p
              className={cn(
                "text-[13px]",
                data.status === "past_due" ? "text-warning" : "text-muted-foreground",
              )}
            >
              {statusLine(data)}
            </p>
          </div>
        </div>
        {data.isOwner && (
          <div className="flex flex-wrap gap-2">
            {cardSubscriber && (
              <GhostButton
                disabled={busy !== null}
                onClick={() =>
                  void run("portal", async () => {
                    const result = await send("/api/billing/portal");
                    if (typeof result.url === "string") window.location.assign(result.url);
                  })
                }
              >
                {data.status === "past_due" ? "Update card" : "Manage billing"}
              </GhostButton>
            )}
            {upgradeTo ? (
              <PrimaryButton onClick={() => openUpgrade()}>Upgrade</PrimaryButton>
            ) : (
              <GhostButton onClick={() => openUpgrade()}>See plans</GhostButton>
            )}
          </div>
        )}
      </section>

      {!data.isOwner && (
        <p className="text-[13px] text-muted-foreground">
          This brand uses its owner's plan. Only the owner can change it.
        </p>
      )}

      {pending.map((row) => (
        <div
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--ds-radius-tile)] bg-primary/10 px-4 py-3 text-[13px]"
        >
          <span className="flex items-center gap-2">
            <Check className="h-4 w-4 text-primary" strokeWidth={2.6} />
            {requestLabel(row)} requested. We'll email you to finish payment.
          </span>
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            disabled={busy !== null}
            onClick={() =>
              void run(row.id, async () => {
                await send(`/api/billing/requests?id=${row.id}`, undefined, "DELETE");
                await queryClient.invalidateQueries({ queryKey: ["billing", "requests"] });
              })
            }
          >
            Cancel
          </button>
        </div>
      ))}

      {/* What's left this month */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="ds-label">{current === "free" ? "Your balance" : "This month"}</h3>
          {resets && current !== "free" && (
            <span className="text-[12px] text-muted-foreground">{resets}</span>
          )}
        </div>
        <div className="ds-tile space-y-5 p-5">
          <UsageBar
            label="Credits"
            left={data.meters.credits.available}
            total={Math.max(creditTotal, data.meters.credits.available)}
            note={ofTotal(
              formatNumber(data.meters.credits.available),
              formatNumber(creditTotal),
              data.meters.credits.available <= creditTotal,
            )}
          />
          {(plan.allowances.videoUnits > 0 || data.meters.video.available > 0) && (
            <UsageBar
              label="Videos"
              left={data.meters.video.available}
              total={Math.max(plan.allowances.videoUnits, data.meters.video.available)}
              note={ofTotal(
                formatVideos(data.meters.video.available),
                formatVideos(plan.allowances.videoUnits),
                data.meters.video.available <= plan.allowances.videoUnits,
              )}
            />
          )}
          {(plan.allowances.proMessages > 0 || data.meters.pro_messages.available > 0) && (
            <UsageBar
              label="Pro chat messages"
              left={data.meters.pro_messages.available}
              total={Math.max(plan.allowances.proMessages, data.meters.pro_messages.available)}
              note={ofTotal(
                formatNumber(data.meters.pro_messages.available),
                formatNumber(plan.allowances.proMessages),
                data.meters.pro_messages.available <= plan.allowances.proMessages,
              )}
            />
          )}
          {data.isOwner && (
            <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-4 text-[13px]">
              <span className="text-muted-foreground">
                You're only charged when something works.
              </span>
              <GhostButton className="h-9" onClick={() => openUpgrade(true)}>
                Buy credits
              </GhostButton>
            </div>
          )}
        </div>
      </section>

      {data.isOwner && (team.data?.requests.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h3 className="ds-label">Requests from your team</h3>
          {team.data!.requests.map((request) => (
            <div
              key={request.id}
              className="ds-tile flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px]"
            >
              <span>
                <span className="font-medium">{request.requester}</span>
                <span className="text-muted-foreground">
                  {" "}
                  wants{" "}
                  {request.feature in FEATURES
                    ? FEATURES[request.feature as keyof typeof FEATURES].label
                    : "an upgrade"}{" "}
                  in {request.brand}
                </span>
              </span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                disabled={busy !== null}
                onClick={() =>
                  void run(request.id, async () => {
                    await send("/api/billing/upgrade-requests", { id: request.id }, "PATCH");
                    await queryClient.invalidateQueries({ queryKey: ["billing", "team-requests"] });
                  })
                }
              >
                Dismiss
              </button>
            </div>
          ))}
        </section>
      )}

      {data.isOwner && paused.length > 0 && (
        <section className="space-y-2">
          <h3 className="ds-label">Paused brands</h3>
          <p className="text-[13px] text-muted-foreground">
            Your plan includes {formatNumber(data.limits.brands)}{" "}
            {data.limits.brands === 1 ? "brand" : "brands"}. Paused brands keep their data.
          </p>
          {brands.data!.brands.map((brand) => (
            <div
              key={brand.id}
              className="ds-tile flex items-center justify-between gap-3 px-4 py-3 text-[13px]"
            >
              <span className="flex items-center gap-2">
                {brand.frozen_at ? (
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Check className="h-3.5 w-3.5 text-primary" />
                )}
                {brand.name}
              </span>
              {brand.frozen_at && (
                <GhostButton
                  className="h-8"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(brand.id, async () => {
                      await send("/api/billing/brands", { workspaceId: brand.id });
                      await queryClient.invalidateQueries({ queryKey: ["billing"] });
                      emitAppEvent("billing:changed");
                    })
                  }
                >
                  Use this one
                </GhostButton>
              )}
            </div>
          ))}
        </section>
      )}

      <LockedFeatures onBeforeOpen={onDone} />

      <RecentActivity />

      {cardSubscriber && data.status !== "canceled" && (
        <div className="text-[12.5px] text-muted-foreground">
          {confirmCancel ? (
            <span className="flex flex-wrap items-center gap-2">
              Your plan stays active until the end of this billing period.
              <button
                type="button"
                className="font-medium text-destructive"
                disabled={busy !== null}
                onClick={() =>
                  void run("cancel", async () => {
                    await send("/api/billing/subscription/cancel");
                    emitAppEvent("billing:changed");
                    setConfirmCancel(false);
                    toast.success("Your plan will end at the end of this period.");
                  })
                }
              >
                Cancel plan
              </button>
              <button type="button" onClick={() => setConfirmCancel(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="underline-offset-4 hover:text-foreground hover:underline"
              onClick={() => setConfirmCancel(true)}
            >
              Cancel plan
            </button>
          )}
        </div>
      )}
    </>
  );
}

type LedgerEntry = {
  id: number;
  meter: string;
  kind: string;
  delta: number;
  heldDelta: number;
  action: string | null;
  at: string;
};

/**
 * What a ledger row did to the balance a person sees. A hold only sets money
 * aside and a release gives it back, so neither is shown; a capture is the
 * real charge.
 */
function effectiveDelta(entry: LedgerEntry): number {
  if (entry.kind === "hold" || entry.kind === "release") return 0;
  if (entry.kind === "capture") return Number(entry.delta) + Number(entry.heldDelta ?? 0);
  return Number(entry.delta);
}

function RecentActivity() {
  const workspaceId = useOptionalWorkspaceId();
  const [all, setAll] = useState(false);
  const history = useQuery({
    queryKey: ["billing", "history", workspaceId ?? "own"],
    queryFn: () =>
      getJson<{ entries: LedgerEntry[] }>(
        `/api/billing/history${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`,
        workspaceId,
      ),
  });
  const rows = (history.data?.entries ?? [])
    .map((entry) => ({ ...entry, amount: effectiveDelta(entry) }))
    .filter((entry) => entry.amount !== 0);
  if (history.isLoading) return <Skeleton className="h-24 w-full rounded-2xl" />;
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <section className="space-y-2">
      <h3 className="ds-label">Recent activity</h3>
      <div className="ds-tile divide-y divide-border/50">
        {shown.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
          >
            <span className="min-w-0 truncate">
              {ledgerLabel(entry)}
              <span className="text-muted-foreground"> · {day(entry.at)}</span>
            </span>
            <span
              className={cn(
                "shrink-0 font-medium tabular-nums",
                entry.amount > 0 ? "text-primary" : "text-foreground",
              )}
            >
              {entry.amount > 0 ? "+" : "−"}
              {formatMeter(entry.meter, Math.abs(entry.amount))}
            </span>
          </div>
        ))}
      </div>
      {rows.length > 5 && (
        <button
          type="button"
          onClick={() => setAll((value) => !value)}
          className="text-[12.5px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {all ? "Show less" : "Show all"}
        </button>
      )}
    </section>
  );
}
