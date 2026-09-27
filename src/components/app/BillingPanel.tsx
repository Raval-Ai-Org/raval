"use client";

import { useEffect, useState } from "react";
import { CreditCard, LockKeyhole, Wallet } from "lucide-react";
import { toast } from "sonner";
import { AppModalShell } from "@/components/app/AppModalShell";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { emitAppEvent, onAppEvent } from "@/lib/app-events";
import { authedFetch } from "@/lib/authed-fetch";
import {
  ADDONS,
  CREDIT_PACKS,
  FEATURES,
  PLAN_ORDER,
  PLANS,
  VIDEO_PACKS,
  annualMonthlyUsd,
  featuresGained,
  type FeatureKey,
  type PlanId,
  type PaidPlanId,
} from "@/lib/billing/catalog";
import { useEntitlements } from "@/lib/billing/use-entitlements";

type Blocked = {
  code: string;
  feature?: string;
  requiredPlan?: string;
  meter?: string;
  needed?: number;
  available?: number;
  limit?: string;
  used?: number;
  max?: number;
};

const number = (value: number) => new Intl.NumberFormat().format(value);
const plan = (value: unknown): PlanId =>
  typeof value === "string" && value in PLANS ? (value as PlanId) : "free";

export function WalletPill() {
  const { data } = useEntitlements();
  if (!data) return null;
  const credits = data.meters.credits.available;
  const video = data.meters.video.available / 100;
  return (
    <button
      type="button"
      onClick={() => emitAppEvent("open:usage")}
      aria-label="Open plan and billing"
      className="hidden items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted sm:inline-flex"
    >
      <Wallet className="h-3.5 w-3.5" aria-hidden />
      <span>
        {number(credits)} credits · {video.toFixed(1)} videos
      </span>
    </button>
  );
}

function Meter({
  label,
  available,
  held,
  allowance,
  scale = 1,
  nextExpiry,
}: {
  label: string;
  available: number;
  held: number;
  allowance: number;
  scale?: number;
  nextExpiry?: string | null;
}) {
  const used = Math.max(0, allowance - available - held);
  const pct = allowance > 0 ? Math.min(100, Math.round((used / allowance) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-3 text-sm">
        <span>{label}</span>
        <strong>{number(available / scale)} left</strong>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {held > 0 && (
        <p className="text-xs text-muted-foreground">
          {number(held / scale)} reserved for work in progress
        </p>
      )}
      {nextExpiry && (
        <p className="text-xs text-muted-foreground">
          Next expiry: {new Date(nextExpiry).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

export function BillingPanel() {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useEntitlements({ enabled: open });
  const workspaceId = useOptionalWorkspaceId();
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [annual, setAnnual] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<{
    plan: PaidPlanId;
    interval: "month" | "year";
    amountDueNowCents: number;
    effectiveAt: string;
    scheduled: boolean;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<"cancel" | "pause" | null>(null);
  const [pendingAddon, setPendingAddon] = useState<{
    key: keyof typeof ADDONS;
    quantity: number;
    amountDueNowCents: number;
    scheduled: boolean;
    effectiveAt: string;
  } | null>(null);
  const [history, setHistory] = useState<
    Array<{
      id: number;
      meter: string;
      kind: string;
      delta: number;
      action: string | null;
      at: string;
    }>
  >([]);
  const [historyError, setHistoryError] = useState(false);
  const [brands, setBrands] = useState<
    Array<{
      id: string;
      name: string;
      frozen_at: string | null;
    }>
  >([]);
  useEffect(() => {
    const offUsage = onAppEvent("open:usage", () => {
      setBlocked(null);
      setOpen(true);
    });
    const offBlocked = onAppEvent("billing:blocked", (event) => {
      setBlocked(event.detail);
      setOpen(true);
    });
    return () => {
      offUsage();
      offBlocked();
    };
  }, []);
  useEffect(() => {
    if (!open || !data) return;
    let current = true;
    const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    void authedFetch(`/api/billing/history${query}`, { workspaceId })
      .then(async (response) => {
        if (!response.ok) throw new Error("history");
        const result = (await response.json()) as { entries: typeof history };
        if (current) setHistory(result.entries);
      })
      .catch(() => {
        if (current) setHistoryError(true);
      });
    return () => {
      current = false;
    };
  }, [open, data, workspaceId]);
  useEffect(() => {
    if (!open || !data?.isOwner) return;
    let current = true;
    void authedFetch("/api/billing/brands")
      .then(async (response) => {
        if (!response.ok) throw new Error("brands");
        const result = (await response.json()) as { brands: typeof brands };
        if (current) setBrands(result.brands);
      })
      .catch(() => {
        if (current) setBrands([]);
      });
    return () => {
      current = false;
    };
  }, [open, data?.isOwner, data?.usage.brands]);

  async function request(path: string, body?: object): Promise<Record<string, unknown>> {
    const response = await authedFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new Error(String(result.message ?? result.error ?? "Billing request failed."));
    return result;
  }

  async function checkout(
    kind: "plan" | "credit_pack" | "video_pack",
    key: string,
    interval?: "month" | "year",
    trial?: boolean,
  ) {
    setBusy(key);
    try {
      const result = await request("/api/billing/checkout", {
        kind,
        key,
        quantity: 1,
        interval,
        trial,
      });
      if (typeof result.url !== "string") throw new Error("Stripe did not return a checkout page.");
      window.location.assign(result.url);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Checkout failed.");
    } finally {
      setBusy(null);
    }
  }

  async function choosePlan(id: PaidPlanId) {
    if (!data) return;
    const interval = annual ? "year" : "month";
    if (["active", "past_due", "paused", "trialing"].includes(data.status)) {
      setBusy(id);
      try {
        const preview = await request("/api/billing/subscription/preview", { plan: id, interval });
        setPendingPlan({
          plan: id,
          interval,
          amountDueNowCents: Number(preview.amountDueNowCents ?? 0),
          effectiveAt: String(preview.effectiveAt),
          scheduled: Boolean(preview.scheduled),
        });
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Could not preview the plan.");
      } finally {
        setBusy(null);
      }
    } else await checkout("plan", id, interval);
  }

  async function confirmPlan() {
    if (!pendingPlan) return;
    setBusy("change");
    try {
      const result = await request("/api/billing/subscription/change", {
        plan: pendingPlan.plan,
        interval: pendingPlan.interval,
      });
      toast.success(result.scheduled ? "Plan change scheduled." : "Plan updated.");
      setPendingPlan(null);
      emitAppEvent("billing:changed");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Plan change failed.");
    } finally {
      setBusy(null);
    }
  }

  async function chooseAddon(key: keyof typeof ADDONS, quantity: number) {
    setBusy(key);
    try {
      const preview = await request("/api/billing/addons/preview", { key, quantity });
      setPendingAddon({
        key,
        quantity,
        amountDueNowCents: Number(preview.amountDueNowCents ?? 0),
        scheduled: Boolean(preview.scheduled),
        effectiveAt: String(preview.effectiveAt),
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not preview the add-on.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmAddon() {
    if (!pendingAddon) return;
    setBusy("addon");
    try {
      const result = await request("/api/billing/addons/change", {
        key: pendingAddon.key,
        quantity: pendingAddon.quantity,
      });
      toast.success(result.scheduled ? "Add-on change scheduled." : "Add-on updated.");
      setPendingAddon(null);
      emitAppEvent("billing:changed");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Add-on change failed.");
    } finally {
      setBusy(null);
    }
  }

  async function manage(action: "portal" | "cancel" | "pause" | "resume") {
    setBusy(action);
    try {
      const result = await request(
        action === "portal" ? "/api/billing/portal" : `/api/billing/subscription/${action}`,
      );
      if (action === "portal" && typeof result.url === "string") window.location.assign(result.url);
      else {
        toast.success(action === "cancel" ? "Cancellation scheduled." : "Billing updated.");
        emitAppEvent("billing:changed");
      }
      setPendingAction(null);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Billing request failed.");
    } finally {
      setBusy(null);
    }
  }
  async function selectBrand(workspaceId: string) {
    setBusy("brand");
    try {
      await request("/api/billing/brands", { workspaceId });
      const response = await authedFetch("/api/billing/brands");
      if (!response.ok) throw new Error("Could not refresh your brands.");
      const result = (await response.json()) as { brands: typeof brands };
      setBrands(result.brands);
      emitAppEvent("billing:changed");
      toast.success("Active brand updated.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not update your brand.");
    } finally {
      setBusy(null);
    }
  }
  const current = plan(data?.entitledPlan);
  const required = plan(blocked?.requiredPlan);
  const feature =
    blocked?.feature && blocked.feature in FEATURES
      ? FEATURES[blocked.feature as FeatureKey]
      : null;
  const suggested = blocked?.code === "upgrade_required" ? required : current;
  const brandLimit = blocked?.max ?? data?.limits.brands ?? 0;
  const nextBrandPlan =
    blocked?.code === "limit_reached" && blocked.limit === "brands"
      ? PLAN_ORDER.find((id) => PLANS[id].brands > brandLimit)
      : undefined;
  const title =
    blocked?.code === "insufficient_balance"
      ? "Add to your balance"
      : blocked?.code === "limit_reached"
        ? "Plan limit reached"
        : feature
          ? `Unlock ${feature.label}`
          : "Plan & billing";
  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      title={title}
      description={feature?.pitch ?? "Your account plan, shared balances and options."}
      Icon={blocked ? LockKeyhole : CreditCard}
      size="xl"
    >
      <div className="space-y-6 p-1">
        {isLoading && <p className="text-sm text-muted-foreground">Loading your plan…</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
        {data && (
          <>
            {blocked && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
                {blocked.code === "upgrade_required" && (
                  <p>
                    {PLANS[required].label} unlocks {feature?.label ?? "this feature"}.{" "}
                    {data.isOwner
                      ? "Choose a plan below to see what it adds."
                      : "Only the billing account owner can change plans."}
                  </p>
                )}
                {blocked.code === "insufficient_balance" && (
                  <p>
                    This action needs {number(blocked.needed ?? 0)}{" "}
                    {blocked.meter === "video" ? "Video Credits" : "Mellox Credits"};{" "}
                    {number(blocked.available ?? 0)} are available.
                  </p>
                )}
                {blocked.code === "limit_reached" && (
                  <p>
                    {blocked.limit === "brands"
                      ? `Your ${PLANS[current].label} plan allows ${number(brandLimit)} active ${brandLimit === 1 ? "brand" : "brands"}; ${number(blocked.used ?? 0)} are in use. `
                      : `${blocked.limit ?? "This allowance"} is at ${number(blocked.used ?? 0)} of ${number(blocked.max ?? 0)}. `}
                    {nextBrandPlan
                      ? `${PLANS[nextBrandPlan].label} supports ${PLANS[nextBrandPlan].brands} brands from $${PLANS[nextBrandPlan].priceMonthlyUsd}/month. `
                      : "Review the plans below for a higher limit. "}
                    {data.isOwner
                      ? data.purchasesAvailable
                        ? "Choose a plan below to upgrade."
                        : "Upgrades will open when Stripe billing is connected."
                      : "Ask the billing account owner to upgrade."}
                  </p>
                )}
                {blocked.code === "brand_frozen" && (
                  <p>
                    This brand is paused under the account’s current plan. The owner can choose an
                    active brand or upgrade.
                  </p>
                )}
              </div>
            )}
            <div className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Current plan
                  </p>
                  <h3 className="text-lg font-semibold">
                    {PLANS[current].label}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      · {data.status}
                    </span>
                  </h3>
                </div>
                {!data.isOwner && (
                  <span className="rounded-full bg-muted px-3 py-1 text-xs">
                    Using the owner’s plan
                  </span>
                )}
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Meter
                  label="Mellox Credits"
                  available={data.meters.credits.available}
                  held={data.meters.credits.held}
                  allowance={PLANS[current].allowances.credits}
                  nextExpiry={data.meters.credits.nextExpiry}
                />
                <Meter
                  label="Video Credits"
                  available={data.meters.video.available}
                  held={data.meters.video.held}
                  allowance={PLANS[current].allowances.videoUnits}
                  nextExpiry={data.meters.video.nextExpiry}
                  scale={100}
                />
                <Meter
                  label="Pro messages"
                  available={data.meters.pro_messages.available}
                  held={data.meters.pro_messages.held}
                  allowance={PLANS[current].allowances.proMessages}
                  nextExpiry={data.meters.pro_messages.nextExpiry}
                />
                <Meter
                  label="Flash messages"
                  available={data.meters.flash_messages.available}
                  held={data.meters.flash_messages.held}
                  allowance={PLANS[current].allowances.flashMessages}
                  nextExpiry={data.meters.flash_messages.nextExpiry}
                />
              </div>
              {data.period.nextGrantAt && (
                <p className="mt-4 text-xs text-muted-foreground">
                  Next allowance: {new Date(data.period.nextGrantAt).toLocaleDateString()}
                </p>
              )}
            </div>
            {data.isOwner && brands.some((brand) => brand.frozen_at) && (
              <section
                aria-label="Active brands"
                className="space-y-2 rounded-xl border p-4 text-sm"
              >
                <h3 className="font-semibold">Choose active brands</h3>
                <p className="text-xs text-muted-foreground">
                  Your plan allows {number(data.limits.brands)} active brands. Frozen brands keep
                  their data and can be restored after an upgrade.
                </p>
                <div className="space-y-1">
                  {brands.map((brand) => (
                    <div
                      key={brand.id}
                      className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2"
                    >
                      <span>
                        {brand.name} · {brand.frozen_at ? "Read only" : "Active"}
                      </span>
                      {brand.frozen_at && data.limits.brands > 0 && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void selectBrand(brand.id)}
                          className="rounded-full border px-3 py-1 text-xs disabled:opacity-50"
                        >
                          Keep active
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
            <section aria-label="Plans">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-semibold">Plans</h3>
                <button
                  type="button"
                  onClick={() => setAnnual(!annual)}
                  className="rounded-lg border px-3 py-1.5 text-xs"
                >
                  {annual ? "Annual · 2 months free" : "Monthly"}
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-5">
                {PLAN_ORDER.map((id) => (
                  <article
                    key={id}
                    className={`rounded-xl border p-3 ${id === suggested ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <h4 className="font-semibold">{PLANS[id].label}</h4>
                    <p className="mt-1 text-lg font-bold">
                      ${annual ? annualMonthlyUsd(id).toFixed(2) : PLANS[id].priceMonthlyUsd}
                      <span className="text-xs font-normal text-muted-foreground">/mo</span>
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">{PLANS[id].tagline}</p>
                    <ul className="mt-3 space-y-1 text-xs">
                      {PLANS[id].highlights.slice(0, 3).map((line) => (
                        <li key={line}>✓ {line}</li>
                      ))}
                    </ul>
                    {id === required && blocked?.code === "upgrade_required" && (
                      <p className="mt-3 text-xs text-primary">
                        Also unlocks{" "}
                        {featuresGained(current, id)
                          .map((item) => item.label)
                          .slice(0, 3)
                          .join(", ")}
                      </p>
                    )}
                    {id === current && <p className="mt-3 text-xs font-semibold">Current plan</p>}
                    {id !== "free" && data.isOwner && (
                      <button
                        type="button"
                        disabled={!data.purchasesAvailable || busy !== null}
                        onClick={() => void choosePlan(id)}
                        className="mt-4 w-full rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy === id
                          ? "Loading…"
                          : id === current
                            ? "Switch billing"
                            : "Choose plan"}
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </section>
            {pendingPlan && (
              <section
                aria-label="Review plan change"
                className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm"
              >
                <h3 className="font-semibold">Review {PLANS[pendingPlan.plan].label}</h3>
                <p className="mt-1">
                  {pendingPlan.scheduled
                    ? `Starts ${new Date(pendingPlan.effectiveAt).toLocaleDateString()}; no charge today.`
                    : `Estimated amount due now: $${(pendingPlan.amountDueNowCents / 100).toFixed(2)}. Stripe calculates the final tax and total.`}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void confirmPlan()}
                    className="rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Confirm change
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingPlan(null)}
                    className="rounded-full border px-4 py-2"
                  >
                    Keep current plan
                  </button>
                </div>
              </section>
            )}
            {data.isOwner && data.status === "free" && !data.trial.used && (
              <button
                type="button"
                disabled={!data.purchasesAvailable || busy !== null}
                onClick={() => void checkout("plan", "growth", annual ? "year" : "month", true)}
                className="rounded-full border border-primary px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50"
              >
                Start 14-day Growth trial
              </button>
            )}
            {data.isOwner && data.status === "active" && (
              <section aria-label="Add-ons" className="space-y-3">
                <h3 className="font-semibold">Add-ons</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.values(ADDONS)
                    .filter(
                      (addon) =>
                        addon.availability === "launch" &&
                        addon.plans.includes(current as PaidPlanId),
                    )
                    .map((addon) => {
                      const quantity =
                        data.addons.find((item) => item.key === addon.key)?.quantity ?? 0;
                      return (
                        <div
                          key={addon.key}
                          className="flex items-center justify-between gap-2 rounded-xl border p-3 text-sm"
                        >
                          <div>
                            <p className="font-medium">{addon.label}</p>
                            <p className="text-xs text-muted-foreground">
                              ${addon.usdPerMonth}/mo · {quantity} active
                            </p>
                          </div>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              aria-label={`Remove one ${addon.label}`}
                              disabled={!data.purchasesAvailable || busy !== null || quantity === 0}
                              onClick={() => void chooseAddon(addon.key, quantity - 1)}
                              className="rounded-full border px-2 py-1 disabled:opacity-40"
                            >
                              −
                            </button>
                            <button
                              type="button"
                              aria-label={`Add one ${addon.label}`}
                              disabled={
                                !data.purchasesAvailable || busy !== null || quantity >= 100
                              }
                              onClick={() => void chooseAddon(addon.key, quantity + 1)}
                              className="rounded-full border px-2 py-1 disabled:opacity-40"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
                {pendingAddon && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
                    <p className="font-semibold">
                      {ADDONS[pendingAddon.key].label} · {pendingAddon.quantity}
                    </p>
                    <p>
                      {pendingAddon.scheduled
                        ? `Changes ${new Date(pendingAddon.effectiveAt).toLocaleDateString()}; no charge today.`
                        : `Estimated amount due now: $${(pendingAddon.amountDueNowCents / 100).toFixed(2)}.`}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void confirmAddon()}
                        className="rounded-full bg-primary px-3 py-1.5 text-primary-foreground"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingAddon(null)}
                        className="rounded-full border px-3 py-1.5"
                      >
                        Go back
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}
            <section aria-label="Add to your balance" className="space-y-3">
              <h3 className="font-semibold">Add to your balance</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ...CREDIT_PACKS.map((item) => ({
                    ...item,
                    kind: "credit_pack" as const,
                    amount: `${number(item.credits + item.bonusCredits)} credits`,
                  })),
                  ...VIDEO_PACKS.map((item) => ({
                    ...item,
                    kind: "video_pack" as const,
                    amount: `${item.videoUnits / 100} Video Credits`,
                  })),
                ].map((item) => (
                  <div key={item.key} className="rounded-xl border p-3 text-sm">
                    <p className="font-semibold">{item.amount}</p>
                    <p className="text-muted-foreground">${item.usd} one time · never expires</p>
                    {data.isOwner && (
                      <button
                        type="button"
                        disabled={!data.purchasesAvailable || busy !== null}
                        onClick={() => void checkout(item.kind, item.key)}
                        className="mt-2 rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                      >
                        Buy pack
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
            {data.isOwner && ["active", "past_due", "trialing", "paused"].includes(data.status) && (
              <section
                aria-label="Manage subscription"
                className="space-y-3 rounded-xl border p-4 text-sm"
              >
                <h3 className="font-semibold">Manage subscription</h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void manage("portal")}
                    className="rounded-full border px-3 py-2"
                  >
                    Payment details and invoices
                  </button>
                  {data.status === "paused" ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void manage("resume")}
                      className="rounded-full border px-3 py-2"
                    >
                      Resume
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setPendingAction("pause")}
                        className="rounded-full border px-3 py-2"
                      >
                        Pause for $9/mo
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingAction("cancel")}
                        className="rounded-full border px-3 py-2"
                      >
                        Cancel plan
                      </button>
                    </>
                  )}
                </div>
                {pendingAction && (
                  <div className="rounded-lg bg-muted p-3">
                    <p>
                      {pendingAction === "cancel"
                        ? "Your plan stays active until the current period ends."
                        : "Pause makes your brands read-only; annual plans pause at the end of the paid year."}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void manage(pendingAction)}
                        className="rounded-full bg-primary px-3 py-1.5 text-primary-foreground"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingAction(null)}
                        className="rounded-full border px-3 py-1.5"
                      >
                        Go back
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}
            <section aria-label="Recent activity" className="space-y-2">
              <h3 className="font-semibold">Recent activity</h3>
              {historyError ? (
                <p className="text-sm text-muted-foreground">History is temporarily unavailable.</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                  {history.slice(0, 20).map((entry) => (
                    <li key={entry.id} className="flex justify-between gap-3 border-b py-1.5">
                      <span>
                        {entry.action ?? entry.kind} · {entry.meter}
                      </span>
                      <span>
                        {entry.delta > 0 ? "+" : ""}
                        {number(entry.delta)} · {new Date(entry.at).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {!data.purchasesAvailable && data.isOwner && (
              <p className="text-xs text-muted-foreground">
                Purchases will open after Stripe prices and webhooks are connected. Your existing
                balances remain available.
              </p>
            )}
          </>
        )}
      </div>
    </AppModalShell>
  );
}
