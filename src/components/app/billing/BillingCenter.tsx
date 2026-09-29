"use client";

// Plan & billing: one window with a rail — Overview, Plans, Top up, Prices and
// History. Every number comes from the server (entitlements, wallet, ledger)
// or the catalog; the browser never decides a price or a balance.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppModalShell } from "@/components/app/AppModalShell";
import {
  SurfaceLayout,
  SurfacePage,
  Stat,
  Tile,
  GroupLabel,
} from "@/components/app/surface/SurfaceLayout";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  Check,
  Crown,
  Gauge,
  Gift,
  History,
  LayoutGrid,
  Lock,
  Tag,
  Users,
  Wallet,
} from "@/components/icons";
import { emitAppEvent, onAppEvent } from "@/lib/app-events";
import { authedFetch } from "@/lib/authed-fetch";
import {
  ADDONS,
  CREDIT_ACTIONS,
  CREDIT_PACKS,
  FEATURES,
  PLAN_ORDER,
  PLANS,
  SIGNUP_GRANT,
  STUDIO_VIDEO_UNITS,
  VIDEO_OPTIONS,
  VIDEO_PACKS,
  isFeatureAvailable,
  planRank,
  type BillingInterval,
  type FeatureModule,
  type PaidPlanId,
  type PlanId,
} from "@/lib/billing/catalog";
import {
  asPlan,
  formatMeter,
  formatNumber,
  formatUsd,
  formatVideos,
  ledgerLabel,
  nextPlan,
} from "@/lib/billing/present";
import { useEntitlements, type BillingView } from "@/lib/billing/use-entitlements";
import { markNoticesRead, noticeTitle, useBillingNotices } from "@/lib/billing/use-notices";
import { REFERRAL } from "@/lib/billing/catalog";
import { cn } from "@/lib/utils";
import {
  GhostButton,
  IntervalToggle,
  PackCard,
  PlanCard,
  PrimaryButton,
  SentNote,
  UsageBar,
} from "./billing-ui";
import { useBillingActions } from "./use-billing-actions";

type Tab = "overview" | "plans" | "topup" | "prices" | "history";

const NAV = [
  { id: "overview" as const, label: "Overview", icon: Gauge },
  { id: "plans" as const, label: "Plans", icon: Crown },
  { id: "topup" as const, label: "Top up", icon: Wallet },
  { id: "prices" as const, label: "What things cost", icon: Tag },
  { id: "history" as const, label: "History", icon: History },
];

async function getJson<T>(path: string, workspaceId?: string | null): Promise<T> {
  const response = await authedFetch(path, workspaceId ? { workspaceId } : undefined);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? body.message ?? "Could not load this."));
  return body as T;
}

function statusLine(data: BillingView): { text: string; tone: "default" | "warning" | "primary" } {
  if (data.manual) {
    return {
      text: `Active until ${new Date(data.manual.until).toLocaleDateString()}`,
      tone: "primary",
    };
  }
  switch (data.status) {
    case "trialing":
      return {
        text: data.trial.endsAt
          ? `Free trial · ends ${new Date(data.trial.endsAt).toLocaleDateString()}`
          : "Free trial",
        tone: "primary",
      };
    case "active":
      return {
        text: data.period.end
          ? `Renews ${new Date(data.period.end).toLocaleDateString()}`
          : "Active",
        tone: "primary",
      };
    case "past_due":
      return { text: "Payment failed · update your card", tone: "warning" };
    case "paused":
      return { text: "Paused", tone: "warning" };
    case "canceled":
      return { text: "Canceled", tone: "warning" };
    default:
      return { text: "Free forever", tone: "default" };
  }
}

export function BillingCenter() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [interval, setBillingInterval] = useState<BillingInterval>("year");
  const [contact, setContact] = useState("");
  const { data, isLoading, error, refetch } = useEntitlements({ enabled: open });
  const actions = useBillingActions(data);

  useEffect(
    () =>
      onAppEvent("open:usage", (event) => {
        setTab(event.detail?.tab ?? "overview");
        setOpen(true);
      }),
    [],
  );

  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      title="Plan & billing"
      Icon={Wallet}
      size="xl"
      bodyClassName="p-0"
    >
      <SurfaceLayout items={NAV} value={tab} onChange={setTab} label="Plan and billing">
        {isLoading && (
          <SurfacePage>
            <div className="space-y-3">
              <Skeleton className="h-28 w-full rounded-2xl" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-24 rounded-2xl" />
                <Skeleton className="h-24 rounded-2xl" />
              </div>
            </div>
          </SurfacePage>
        )}
        {error && (
          <SurfacePage>
            <ErrorState
              title="Plan & billing isn't available"
              description={error.message}
              onRetry={() => void refetch()}
            />
          </SurfacePage>
        )}
        {data && tab === "overview" && <Overview data={data} goTo={setTab} />}
        {data && tab === "plans" && (
          <Plans
            data={data}
            actions={actions}
            interval={interval}
            setInterval={setBillingInterval}
            contact={contact}
            setContact={setContact}
          />
        )}
        {data && tab === "topup" && (
          <TopUp data={data} actions={actions} contact={contact} setContact={setContact} />
        )}
        {tab === "prices" && <Prices />}
        {data && tab === "history" && <HistoryPage data={data} />}
      </SurfaceLayout>
    </AppModalShell>
  );
}

type Actions = ReturnType<typeof useBillingActions>;

function RequestModeNote({
  contact,
  setContact,
}: {
  contact: string;
  setContact: (value: string) => void;
}) {
  return (
    <Tile className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
      <p className="flex-1 text-[13px]">
        <span className="font-medium">Online payment is coming soon.</span>{" "}
        <span className="text-muted-foreground">
          Choose what you need and we'll contact you to complete payment.
        </span>
      </p>
      <input
        value={contact}
        onChange={(event) => setContact(event.target.value)}
        maxLength={120}
        placeholder="Phone or WhatsApp (optional)"
        aria-label="Phone or WhatsApp (optional)"
        className="h-9 w-full rounded-full bg-[var(--ds-well-bg)] px-4 text-[13px] outline-none ring-primary/40 placeholder:text-muted-foreground focus-visible:ring-2 sm:w-60"
      />
    </Tile>
  );
}

/* ─────────────────────────────── Overview ─────────────────────────────── */

type PurchaseRequestRow = {
  id: string;
  kind: string;
  catalogKey: string;
  interval: string | null;
  status: string;
  createdAt: string;
};

type TeamRequest = {
  id: string;
  brand: string;
  requester: string;
  feature: string;
  requiredPlan: string | null;
  at: string;
};

function requestLabel(row: { kind: string; catalogKey: string; interval: string | null }) {
  if (row.kind === "plan" && row.catalogKey in PLANS) {
    return `${PLANS[row.catalogKey as PlanId].label} plan${row.interval === "year" ? ", yearly" : ""}`;
  }
  const credit = CREDIT_PACKS.find((pack) => pack.key === row.catalogKey);
  if (credit) return formatMeter("credits", credit.credits + credit.bonusCredits);
  const video = VIDEO_PACKS.find((pack) => pack.key === row.catalogKey);
  if (video) return formatMeter("video", video.videoUnits);
  return row.catalogKey;
}

function Overview({ data, goTo }: { data: BillingView; goTo: (tab: Tab) => void }) {
  const queryClient = useQueryClient();
  const current = asPlan(data.entitledPlan);
  const plan = PLANS[current];
  const status = statusLine(data);
  const upgradeTo = nextPlan(current);
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
  const frozen = (brands.data?.brands ?? []).some((brand) => brand.frozen_at);
  const notices = useBillingNotices();
  const recent = (notices.data?.notices ?? []).slice(0, 4);
  const unread = notices.data?.unread ?? 0;
  useEffect(() => {
    // Seen on the overview: clear the dot on the balance pill.
    if (unread === 0) return;
    const timer = window.setTimeout(() => {
      void markNoticesRead().then(() =>
        queryClient.invalidateQueries({ queryKey: ["billing", "notices"] }),
      );
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [unread, queryClient]);
  const [confirm, setConfirm] = useState<"cancel" | "pause" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Credits on Free are the one-time signup grant, so size the bar to it.
  const creditTotal = current === "free" ? SIGNUP_GRANT.credits : plan.allowances.credits;
  const refill = data.period.nextGrantAt
    ? `Refills ${new Date(data.period.nextGrantAt).toLocaleDateString()}`
    : undefined;

  async function post(path: string, body?: unknown, method = "POST") {
    const response = await authedFetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(result.message ?? result.error ?? "Try again."));
    return result;
  }

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

  return (
    <SurfacePage title="Overview" width="wide">
      {!data.isOwner && (
        <Tile className="mb-4 flex items-center gap-3 text-[13px]">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span>This brand uses its owner's plan and balance.</span>
        </Tile>
      )}

      <Tile className="ds-glow flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="ds-label">Your plan</p>
          <p className="mt-1 text-[26px] font-semibold tracking-tight">{plan.label}</p>
          <p
            className={cn(
              "text-[13px]",
              status.tone === "warning"
                ? "text-warning"
                : status.tone === "primary"
                  ? "text-primary"
                  : "text-muted-foreground",
            )}
          >
            {status.text}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.isOwner && upgradeTo && (
            <PrimaryButton
              onClick={() =>
                emitAppEvent("open:upgrade", {
                  code: "upgrade_required",
                  requiredPlan: upgradeTo,
                })
              }
            >
              <Crown className="h-4 w-4" /> Upgrade now
            </PrimaryButton>
          )}
          <GhostButton onClick={() => goTo("plans")}>See plans</GhostButton>
        </div>
      </Tile>

      {recent.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {recent.map((notice) => (
            <div
              key={notice.id}
              className={cn(
                "flex items-center justify-between gap-3 rounded-[var(--ds-radius-well)] px-3.5 py-2.5 text-[13px]",
                notice.read ? "bg-[var(--ds-well-bg)] text-muted-foreground" : "bg-primary/10",
              )}
            >
              <span className="flex items-center gap-2">
                {!notice.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
                {noticeTitle(notice)}
              </span>
              <span className="shrink-0 text-[12px] text-muted-foreground">
                {new Date(notice.at).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="mt-4 space-y-2">
          {pending.map((row) => (
            <SentNote key={row.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{requestLabel(row)}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · request received, we'll contact you
                  </span>
                </span>
                <button
                  type="button"
                  className="text-[12.5px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(row.id, async () => {
                      await post(`/api/billing/requests?id=${row.id}`, undefined, "DELETE");
                      await queryClient.invalidateQueries({ queryKey: ["billing", "requests"] });
                    })
                  }
                >
                  Cancel request
                </button>
              </div>
            </SentNote>
          ))}
        </div>
      )}

      {data.status === "past_due" && data.isOwner && (
        <Tile className="mt-4 flex items-center justify-between gap-3 border-warning/40 text-[13px]">
          <span>Your last payment didn't go through. Update your card to keep your plan.</span>
          <GhostButton
            disabled={busy !== null}
            onClick={() =>
              void run("portal", async () => {
                const result = await post("/api/billing/portal");
                if (typeof result.url === "string") window.location.assign(result.url);
              })
            }
          >
            Update card
          </GhostButton>
        </Tile>
      )}

      <GroupLabel
        action={
          data.isOwner ? (
            <button
              type="button"
              onClick={() => goTo("topup")}
              className="text-[12.5px] font-medium text-primary hover:underline"
            >
              Top up
            </button>
          ) : undefined
        }
      >
        Balance
      </GroupLabel>
      <div className="grid gap-3 sm:grid-cols-2">
        <Tile>
          <UsageBar
            label="Credits"
            left={data.meters.credits.available}
            total={Math.max(creditTotal, data.meters.credits.available)}
            leftText={formatNumber(data.meters.credits.available)}
            hint={
              current === "free"
                ? data.meters.credits.nextExpiry
                  ? `Free credits expire ${new Date(data.meters.credits.nextExpiry).toLocaleDateString()}`
                  : "For posts, images, articles and research"
                : refill
            }
          />
        </Tile>
        <Tile>
          <UsageBar
            label="Videos"
            left={data.meters.video.available}
            total={Math.max(plan.allowances.videoUnits, data.meters.video.available)}
            leftText={formatVideos(data.meters.video.available)}
            hint={
              plan.allowances.videoUnits === 0 && data.meters.video.available === 0
                ? "Included from Starter"
                : refill
            }
          />
        </Tile>
        <Tile>
          <UsageBar
            label="Pro messages"
            left={data.meters.pro_messages.available}
            total={Math.max(plan.allowances.proMessages, data.meters.pro_messages.available)}
            leftText={formatNumber(data.meters.pro_messages.available)}
            hint={
              plan.allowances.proMessages === 0
                ? "Our smartest chat, included from Starter"
                : `Then ${CREDIT_ACTIONS.pro_message.credits} credits a message`
            }
          />
        </Tile>
        <Tile>
          <UsageBar
            label="Chat messages"
            left={data.meters.flash_messages.available}
            total={Math.max(plan.allowances.flashMessages, data.meters.flash_messages.available)}
            leftText={formatNumber(data.meters.flash_messages.available)}
            hint={`Then ${CREDIT_ACTIONS.flash_message_over_cap.credits} credits a message`}
          />
        </Tile>
      </div>
      {(data.meters.credits.held > 0 || data.meters.video.held > 0) && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          {[
            data.meters.credits.held > 0 && formatMeter("credits", data.meters.credits.held),
            data.meters.video.held > 0 && formatMeter("video", data.meters.video.held),
          ]
            .filter(Boolean)
            .join(" and ")}{" "}
          set aside for work in progress. You're only charged if it succeeds.
        </p>
      )}

      <GroupLabel>Plan limits</GroupLabel>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Brands"
          icon={Building2}
          value={`${formatNumber(data.usage.brands)} / ${formatNumber(data.limits.brands)}`}
          tone={data.usage.brands >= data.limits.brands ? "warning" : "default"}
        />
        <Stat
          label="Team seats"
          icon={Users}
          value={`${formatNumber(data.usage.seats)} / ${data.limits.seats === null ? "∞" : formatNumber(data.limits.seats)}`}
          tone={
            data.limits.seats !== null && data.usage.seats >= data.limits.seats
              ? "warning"
              : "default"
          }
        />
        <Stat
          label="Site scans this month"
          icon={LayoutGrid}
          value={`${formatNumber(data.usage.scansUsed)} / ${formatNumber(data.limits.scansPerMonth)}`}
        />
        <Stat
          label="Competitors tracked"
          icon={Gauge}
          value={`${formatNumber(data.usage.competitors)} / ${formatNumber(data.limits.competitors)}`}
        />
        <Stat
          label="Experiments running"
          icon={Gauge}
          value={`${formatNumber(data.usage.openExperiments)} / ${formatNumber(data.limits.maxConcurrentExperiments)}`}
        />
        <Stat label="Social posts" icon={Check} value="Unlimited" tone="primary" />
      </div>

      {data.isOwner && (team.data?.requests.length ?? 0) > 0 && (
        <>
          <GroupLabel>Requests from your team</GroupLabel>
          <div className="space-y-2">
            {team.data!.requests.map((request) => (
              <Tile
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-3 text-[13px]"
              >
                <span>
                  <span className="font-medium">{request.requester}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    asked for{" "}
                    {request.feature in FEATURES
                      ? FEATURES[request.feature as keyof typeof FEATURES].label
                      : "more"}{" "}
                    in {request.brand}
                  </span>
                </span>
                <div className="flex gap-2">
                  {request.requiredPlan && request.requiredPlan in PLANS && (
                    <GhostButton
                      className="h-8"
                      onClick={() =>
                        emitAppEvent("open:upgrade", {
                          code: "upgrade_required",
                          feature: request.feature,
                          requiredPlan: request.requiredPlan ?? undefined,
                        })
                      }
                    >
                      Upgrade
                    </GhostButton>
                  )}
                  <GhostButton
                    className="h-8"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(request.id, async () => {
                        await post("/api/billing/upgrade-requests", { id: request.id }, "PATCH");
                        await queryClient.invalidateQueries({
                          queryKey: ["billing", "team-requests"],
                        });
                      })
                    }
                  >
                    Dismiss
                  </GhostButton>
                </div>
              </Tile>
            ))}
          </div>
        </>
      )}

      {data.isOwner && frozen && (
        <>
          <GroupLabel>Active brands</GroupLabel>
          <div className="space-y-2">
            {brands.data!.brands.map((brand) => (
              <Tile key={brand.id} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="flex items-center gap-2">
                  {brand.frozen_at ? (
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  )}
                  {brand.name}
                  <span className="text-muted-foreground">
                    {brand.frozen_at ? "· paused, data kept" : "· active"}
                  </span>
                </span>
                {brand.frozen_at && (
                  <GhostButton
                    className="h-8"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(brand.id, async () => {
                        await post("/api/billing/brands", { workspaceId: brand.id });
                        await queryClient.invalidateQueries({ queryKey: ["billing"] });
                        emitAppEvent("billing:changed");
                        toast.success(`${brand.name} is active.`);
                      })
                    }
                  >
                    Make active
                  </GhostButton>
                )}
              </Tile>
            ))}
          </div>
        </>
      )}

      {data.isOwner &&
        data.checkoutMode === "card" &&
        ["active", "past_due", "trialing", "paused"].includes(data.status) &&
        !data.manual && (
          <>
            <GroupLabel>Subscription</GroupLabel>
            <Tile className="space-y-3 text-[13px]">
              <div className="flex flex-wrap gap-2">
                <GhostButton
                  disabled={busy !== null}
                  onClick={() =>
                    void run("portal", async () => {
                      const result = await post("/api/billing/portal");
                      if (typeof result.url === "string") window.location.assign(result.url);
                    })
                  }
                >
                  Invoices and card
                </GhostButton>
                {data.status === "paused" ? (
                  <GhostButton
                    disabled={busy !== null}
                    onClick={() =>
                      void run("resume", async () => {
                        await post("/api/billing/subscription/resume");
                        emitAppEvent("billing:changed");
                        toast.success("Welcome back. Your plan is active again.");
                      })
                    }
                  >
                    Resume plan
                  </GhostButton>
                ) : (
                  <>
                    <GhostButton onClick={() => setConfirm("pause")}>Pause for $9/mo</GhostButton>
                    <GhostButton onClick={() => setConfirm("cancel")}>Cancel plan</GhostButton>
                  </>
                )}
              </div>
              {confirm && (
                <div className="rounded-[var(--ds-radius-well)] bg-[var(--ds-well-bg)] p-3">
                  <p>
                    {confirm === "cancel"
                      ? "Your plan stays active until the end of this billing period, then moves to Free. Your data is kept."
                      : "Pausing keeps your data and brands (read-only) for $9 a month. Resume any time."}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <PrimaryButton
                      className="h-9"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(confirm, async () => {
                          await post(`/api/billing/subscription/${confirm}`);
                          emitAppEvent("billing:changed");
                          setConfirm(null);
                          toast.success(
                            confirm === "cancel"
                              ? "Your plan will end at period end."
                              : "Plan paused.",
                          );
                        })
                      }
                    >
                      {confirm === "cancel" ? "Cancel plan" : "Pause plan"}
                    </PrimaryButton>
                    <GhostButton className="h-9" onClick={() => setConfirm(null)}>
                      Keep my plan
                    </GhostButton>
                  </div>
                </div>
              )}
            </Tile>
          </>
        )}

      {data.isOwner && data.referralCode && <ReferralTile code={data.referralCode} />}
    </SurfacePage>
  );
}

function ReferralTile({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/r/${code}`;
  return (
    <>
      <GroupLabel>Invite a friend</GroupLabel>
      <Tile className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[13px]">
          <p className="font-medium">
            You both get {formatNumber(REFERRAL.credits)} credits and {REFERRAL.videoUnits / 100}{" "}
            videos
          </p>
          <p className="text-muted-foreground">When they start a paid plan.</p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <code className="min-w-0 truncate rounded-full bg-[var(--ds-well-bg)] px-3 py-1.5 text-[12px]">
            {link}
          </code>
          <GhostButton
            className="h-9"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </GhostButton>
        </div>
      </Tile>
    </>
  );
}

/* ──────────────────────────────── Plans ──────────────────────────────── */

const MODULES: FeatureModule[] = [
  "Studio",
  "Assistant",
  "UGC video",
  "AI visibility",
  "Intelligence",
  "Distribution",
  "Team",
];

function Plans({
  data,
  actions,
  interval,
  setInterval,
  contact,
  setContact,
}: {
  data: BillingView;
  actions: Actions;
  interval: BillingInterval;
  setInterval: (value: BillingInterval) => void;
  contact: string;
  setContact: (value: string) => void;
}) {
  const current = asPlan(data.entitledPlan);
  const requestMode = data.checkoutMode !== "card";
  const [showTable, setShowTable] = useState(false);
  const subscribed = ["active", "past_due", "paused", "trialing"].includes(data.status);

  function action(plan: PlanId) {
    if (plan === current) {
      return (
        <GhostButton className="w-full" disabled>
          Current plan
        </GhostButton>
      );
    }
    if (!data.isOwner || plan === "free") return null;
    if (actions.sent.has(plan)) {
      return <p className="text-center text-[12.5px] font-medium text-primary">Request sent</p>;
    }
    const higher = planRank(plan) > planRank(current);
    if (!higher && (requestMode || !subscribed)) return null;
    const Button = higher ? PrimaryButton : GhostButton;
    return (
      <Button
        className="w-full"
        disabled={actions.busy !== null}
        onClick={() =>
          void actions.purchase({ kind: "plan", key: plan as PaidPlanId, interval, contact })
        }
      >
        {actions.busy === plan ? "One moment…" : higher ? "Upgrade now" : "Switch plan"}
      </Button>
    );
  }

  return (
    <SurfacePage
      title="Plans"
      actions={<IntervalToggle value={interval} onChange={setInterval} />}
      width="wide"
    >
      {data.isOwner && requestMode && <RequestModeNote contact={contact} setContact={setContact} />}
      {!data.isOwner && (
        <Tile className="mb-5 text-[13px] text-muted-foreground">
          Only the owner of this brand's plan can change it.
        </Tile>
      )}
      <div className="grid gap-4 pt-2 sm:grid-cols-2 xl:grid-cols-5">
        {PLAN_ORDER.map((plan) => (
          <PlanCard
            key={plan}
            plan={plan}
            interval={interval}
            current={plan === current}
            highlighted={plan === "growth" && current !== "growth"}
            compact
            action={action(plan)}
          />
        ))}
      </div>

      <div className="mt-6">
        <GhostButton onClick={() => setShowTable((value) => !value)}>
          {showTable ? "Hide feature comparison" : "Compare all features"}
        </GhostButton>
      </div>
      {showTable && (
        <div className="ds-tile mt-4 overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-border/60 text-left">
                <th className="p-3 font-medium text-muted-foreground">Feature</th>
                {PLAN_ORDER.map((plan) => (
                  <th
                    key={plan}
                    className={cn(
                      "p-3 text-center font-semibold",
                      plan === current && "text-primary",
                    )}
                  >
                    {PLANS[plan].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULES.map((module) => (
                <FeatureRows key={module} module={module} />
              ))}
              <LimitRow
                label="Brands"
                values={PLAN_ORDER.map((p) => formatNumber(PLANS[p].brands))}
              />
              <LimitRow
                label="Team seats"
                values={PLAN_ORDER.map((p) =>
                  PLANS[p].seats === null ? "Unlimited" : formatNumber(PLANS[p].seats ?? 0),
                )}
              />
              <LimitRow
                label="Credits a month"
                values={PLAN_ORDER.map((p) =>
                  p === "free"
                    ? `${SIGNUP_GRANT.credits} once`
                    : formatNumber(PLANS[p].allowances.credits),
                )}
              />
              <LimitRow
                label="Videos a month"
                values={PLAN_ORDER.map((p) => formatVideos(PLANS[p].allowances.videoUnits))}
              />
              <LimitRow
                label="Pro messages a month"
                values={PLAN_ORDER.map((p) => formatNumber(PLANS[p].allowances.proMessages))}
              />
              <LimitRow
                label="Tracked prompts"
                values={PLAN_ORDER.map((p) => formatNumber(PLANS[p].limits.trackedPrompts))}
              />
              <LimitRow label="Social posts" values={PLAN_ORDER.map(() => "Unlimited")} />
              <LimitRow label="Support" values={PLAN_ORDER.map((p) => PLANS[p].support)} />
            </tbody>
          </table>
        </div>
      )}
    </SurfacePage>
  );
}

function FeatureRows({ module }: { module: FeatureModule }) {
  const features = Object.values(FEATURES).filter((feature) => feature.module === module);
  if (!features.length) return null;
  return (
    <>
      <tr>
        <td colSpan={6} className="px-3 pb-1 pt-4 ds-label">
          {module}
        </td>
      </tr>
      {features.map((feature) => (
        <tr key={feature.key} className="border-t border-border/40">
          <td className="p-3">{feature.label}</td>
          {PLAN_ORDER.map((plan) => (
            <td key={plan} className="p-3 text-center">
              {planRank(plan) >= planRank(feature.minPlan) ? (
                isFeatureAvailable(feature.key) ? (
                  <Check className="mx-auto h-4 w-4 text-primary" strokeWidth={2.4} />
                ) : (
                  <span className="text-[12px] text-muted-foreground">Soon</span>
                )
              ) : (
                <span className="text-muted-foreground/50">—</span>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function LimitRow({ label, values }: { label: string; values: string[] }) {
  return (
    <tr className="border-t border-border/40">
      <td className="p-3">{label}</td>
      {values.map((value, index) => (
        <td key={index} className="p-3 text-center tabular-nums">
          {value}
        </td>
      ))}
    </tr>
  );
}

/* ──────────────────────────────── Top up ──────────────────────────────── */

function TopUp({
  data,
  actions,
  contact,
  setContact,
}: {
  data: BillingView;
  actions: Actions;
  contact: string;
  setContact: (value: string) => void;
}) {
  const requestMode = data.checkoutMode !== "card";
  const current = asPlan(data.entitledPlan);
  const [pendingAddon, setPendingAddon] = useState<string | null>(null);

  const buy = (kind: "credit_pack" | "video_pack", key: string) =>
    actions.sent.has(key) ? (
      <p className="text-[12.5px] font-medium text-primary">Request sent</p>
    ) : data.isOwner ? (
      <GhostButton
        className="w-full"
        disabled={actions.busy !== null}
        onClick={() => void actions.purchase({ kind, key, contact })}
      >
        {actions.busy === key ? "One moment…" : requestMode ? "Request" : "Buy"}
      </GhostButton>
    ) : null;

  async function changeAddon(key: string, quantity: number) {
    setPendingAddon(key);
    try {
      const response = await authedFetch("/api/billing/addons/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, quantity }),
      });
      const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(result.message ?? result.error ?? "Try again."));
      toast.success(result.scheduled ? "Change saved for your next bill." : "Add-on updated.");
      emitAppEvent("billing:changed");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Try again.");
    } finally {
      setPendingAddon(null);
    }
  }

  const addons = Object.values(ADDONS).filter(
    (addon) => addon.availability === "launch" && addon.plans.includes(current as PaidPlanId),
  );

  return (
    <SurfacePage title="Top up" width="wide">
      {data.isOwner && requestMode && <RequestModeNote contact={contact} setContact={setContact} />}
      {!data.isOwner && (
        <Tile className="mb-5 text-[13px] text-muted-foreground">
          Only the owner of this brand's plan can buy more.
        </Tile>
      )}
      <GroupLabel>Credits · never expire</GroupLabel>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CREDIT_PACKS.map((pack) => (
          <PackCard
            key={pack.key}
            title={formatMeter("credits", pack.credits + pack.bonusCredits)}
            subtitle="For any AI work"
            price={pack.usd}
            bonus={pack.bonusCredits ? `+${formatNumber(pack.bonusCredits)} bonus` : undefined}
            action={buy("credit_pack", pack.key)}
          />
        ))}
      </div>
      <GroupLabel>Videos · never expire</GroupLabel>
      <div className="grid gap-3 sm:grid-cols-3">
        {VIDEO_PACKS.map((pack) => (
          <PackCard
            key={pack.key}
            title={formatMeter("video", pack.videoUnits)}
            subtitle={`${formatUsd(Math.round((pack.usd / (pack.videoUnits / 100)) * 100) / 100)} a video`}
            price={pack.usd}
            action={buy("video_pack", pack.key)}
          />
        ))}
      </div>
      {data.isOwner &&
        !requestMode &&
        data.status === "active" &&
        !data.manual &&
        addons.length > 0 && (
          <>
            <GroupLabel>Add-ons · monthly</GroupLabel>
            <div className="grid gap-3 sm:grid-cols-2">
              {addons.map((addon) => {
                const quantity = data.addons.find((item) => item.key === addon.key)?.quantity ?? 0;
                return (
                  <Tile key={addon.key} className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[14px] font-semibold">{addon.label}</p>
                      <p className="text-[12px] text-muted-foreground">
                        {formatUsd(addon.usdPerMonth)} a month · {quantity} active
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <GhostButton
                        className="h-8 w-8 px-0"
                        aria-label={`Remove one ${addon.label}`}
                        disabled={pendingAddon !== null || quantity === 0}
                        onClick={() => void changeAddon(addon.key, quantity - 1)}
                      >
                        −
                      </GhostButton>
                      <GhostButton
                        className="h-8 w-8 px-0"
                        aria-label={`Add one ${addon.label}`}
                        disabled={pendingAddon !== null || quantity >= 100}
                        onClick={() => void changeAddon(addon.key, quantity + 1)}
                      >
                        +
                      </GhostButton>
                    </div>
                  </Tile>
                );
              })}
            </div>
          </>
        )}
    </SurfacePage>
  );
}

/* ─────────────────────────── What things cost ─────────────────────────── */

const PRICE_GROUPS: Array<{ title: string; actions: Array<keyof typeof CREDIT_ACTIONS> }> = [
  {
    title: "Create",
    actions: [
      "post_set",
      "image_post",
      "carousel",
      "ad_set",
      "article_standard",
      "article_premium",
      "article_long",
      "script",
      "ideas",
      "image_standard",
      "image_premium",
      "image_edit",
      "campaign",
    ],
  },
  { title: "Brand", actions: ["brand_dna_rescan", "brand_voice_rerun", "file_extract"] },
  {
    title: "Research",
    actions: [
      "coach_briefing",
      "market_brain_manual",
      "competitor_discovery",
      "competitor_profile",
      "competitor_intel",
      "insights_refresh",
    ],
  },
  {
    title: "AI visibility",
    actions: [
      "site_scan_per_100_pages",
      "prompt_check_3_engines",
      "geo_fix",
      "geo_cms_fix",
      "geo_agent_run",
      "experiment",
    ],
  },
  { title: "Chat", actions: ["pro_message", "flash_message_over_cap"] },
];

const ALWAYS_FREE = [
  "Publishing and scheduling posts, on every network",
  "Your first Brand DNA scan for each brand",
  "Weekly Market Brain and Monday Coach briefing",
  "Chat messages up to your monthly allowance",
  "Re-checking a fix after you apply it",
  "Anything that fails. You're only charged when it works",
];

function Prices() {
  const videoRows = useMemo(
    () =>
      [...VIDEO_OPTIONS]
        .sort((a, b) => a.videoUnits - b.videoUnits)
        .map((option) => ({
          label: option.label,
          value: formatMeter("video", option.videoUnits),
          plan: FEATURES[option.feature].minPlan,
        })),
    [],
  );
  return (
    <SurfacePage title="What things cost" width="narrow">
      <Tile className="mb-2">
        <GroupLabel>Always free</GroupLabel>
        <ul className="space-y-2 text-[13px]">
          {ALWAYS_FREE.map((line) => (
            <li key={line} className="flex gap-2">
              <Gift className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              {line}
            </li>
          ))}
        </ul>
      </Tile>
      {PRICE_GROUPS.map((group) => (
        <div key={group.title}>
          <GroupLabel>{group.title}</GroupLabel>
          <Tile className="divide-y divide-border/50 p-0 sm:p-0">
            {group.actions.map((key) => {
              const action = CREDIT_ACTIONS[key];
              const plan = action.feature ? FEATURES[action.feature].minPlan : "free";
              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{action.label}</span>
                    <span className="text-muted-foreground"> · {action.unit}</span>
                    {plan !== "free" && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                        <Lock className="h-3 w-3" />
                        {PLANS[plan].label}+
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {formatMeter("credits", action.credits)}
                  </span>
                </div>
              );
            })}
          </Tile>
        </div>
      ))}
      <GroupLabel>Video</GroupLabel>
      <Tile className="divide-y divide-border/50 p-0 sm:p-0">
        {videoRows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
          >
            <span>
              <span className="font-medium">{row.label}</span>
              {row.plan !== "starter" && row.plan !== "free" && (
                <span className="ml-2 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  {PLANS[row.plan].label}+
                </span>
              )}
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{row.value}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
          <span className="font-medium">Studio video, 6 seconds</span>
          <span className="shrink-0 font-semibold tabular-nums">
            {formatMeter("video", STUDIO_VIDEO_UNITS)}
          </span>
        </div>
      </Tile>
      <p className="mt-3 text-[12px] text-muted-foreground">
        Videos use their own balance, so making videos never uses up the credits you need for posts.
      </p>
    </SurfacePage>
  );
}

/* ──────────────────────────────── History ──────────────────────────────── */

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
 * real charge (the held amount minus anything returned).
 */
function effectiveDelta(entry: LedgerEntry): number {
  if (entry.kind === "hold" || entry.kind === "release") return 0;
  if (entry.kind === "capture") return Number(entry.delta) + Number(entry.heldDelta ?? 0);
  return Number(entry.delta);
}

function HistoryPage({ data }: { data: BillingView }) {
  const workspaceId = useOptionalWorkspaceId();
  const history = useQuery({
    queryKey: ["billing", "history", workspaceId ?? "own"],
    queryFn: () =>
      getJson<{ entries: LedgerEntry[] }>(
        `/api/billing/history${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`,
        workspaceId,
      ),
  });
  // People care about charges, refunds and top-ups, not holds and releases.
  const rows = (history.data?.entries ?? [])
    .map((entry) => ({ ...entry, amount: effectiveDelta(entry) }))
    .filter((entry) => entry.amount !== 0);
  return (
    <SurfacePage
      title="History"
      subtitle={data.isOwner ? undefined : "This brand only"}
      width="narrow"
    >
      {history.isLoading && <Skeleton className="h-48 w-full rounded-2xl" />}
      {history.error && (
        <ErrorState
          title="History isn't available"
          description={history.error.message}
          onRetry={() => void history.refetch()}
        />
      )}
      {history.data && rows.length === 0 && (
        <EmptyState
          icon={History}
          title="Nothing yet"
          description="Charges and top-ups will show here."
        />
      )}
      {rows.length > 0 && (
        <Tile className="divide-y divide-border/50 p-0 sm:p-0">
          {rows.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
            >
              <span className="min-w-0">
                <span className="font-medium">{ledgerLabel(entry)}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {new Date(entry.at).toLocaleDateString()}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 font-semibold tabular-nums",
                  entry.amount > 0 ? "text-primary" : "text-foreground",
                )}
              >
                {entry.amount > 0 ? "+" : "−"}
                {formatMeter(entry.meter, Math.abs(entry.amount))}
              </span>
            </div>
          ))}
        </Tile>
      )}
    </SurfacePage>
  );
}
