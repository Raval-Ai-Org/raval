"use client";

import { useEffect, useState } from "react";
import { CreditCard, LockKeyhole, Wallet } from "lucide-react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { emitAppEvent, onAppEvent } from "@/lib/app-events";
import {
  FEATURES,
  PLAN_ORDER,
  PLANS,
  annualMonthlyUsd,
  featuresGained,
  type FeatureKey,
  type PlanId,
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
  const credits = data?.meters.credits.available ?? 0;
  const video = (data?.meters.video.available ?? 0) / 100;
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
}: {
  label: string;
  available: number;
  held: number;
  allowance: number;
}) {
  const used = Math.max(0, allowance - available - held);
  const pct = allowance > 0 ? Math.min(100, Math.round((used / allowance) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-3 text-sm">
        <span>{label}</span>
        <strong>{number(available)} left</strong>
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
          {number(held)} reserved for work in progress
        </p>
      )}
    </div>
  );
}

export function BillingPanel() {
  const { data, isLoading, error } = useEntitlements();
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [annual, setAnnual] = useState(true);
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
  const current = plan(data?.entitledPlan);
  const required = plan(blocked?.requiredPlan);
  const feature =
    blocked?.feature && blocked.feature in FEATURES
      ? FEATURES[blocked.feature as FeatureKey]
      : null;
  const suggested = blocked?.code === "upgrade_required" ? required : current;
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
                    {blocked.limit ?? "This allowance"} is at {number(blocked.used ?? 0)} of{" "}
                    {number(blocked.max ?? 0)}. Review the plans below for a higher limit.
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
                />
                <Meter
                  label="Video Credits"
                  available={data.meters.video.available}
                  held={data.meters.video.held}
                  allowance={PLANS[current].allowances.videoUnits}
                />
                <Meter
                  label="Pro messages"
                  available={data.meters.pro_messages.available}
                  held={data.meters.pro_messages.held}
                  allowance={PLANS[current].allowances.proMessages}
                />
                <Meter
                  label="Flash messages"
                  available={data.meters.flash_messages.available}
                  held={data.meters.flash_messages.held}
                  allowance={PLANS[current].allowances.flashMessages}
                />
              </div>
              {data.period.nextGrantAt && (
                <p className="mt-4 text-xs text-muted-foreground">
                  Next allowance: {new Date(data.period.nextGrantAt).toLocaleDateString()}
                </p>
              )}
            </div>
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
                  </article>
                ))}
              </div>
            </section>
            <p className="text-xs text-muted-foreground">
              Plan changes and pack purchases will become available when Paddle checkout is
              connected. Your balances above are live.
            </p>
          </>
        )}
      </div>
    </AppModalShell>
  );
}
