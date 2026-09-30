"use client";

// The upgrade screen, like every familiar SaaS: plans side by side with a
// Monthly/Yearly switch, the right plan marked "Recommended", and a
// "Credit packs" view for one-off top-ups. Opens only from a person's click
// (the Upgrade button, a lock, or the button on an "out of credits" toast).
//
// Until card payment is connected, choosing a plan or pack shows a short
// confirm step and sends a request; Mellox activates it after payment.

import { useEffect, useMemo, useState } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Skeleton } from "@/components/ui/skeleton";
import { Crown, Lock, Sparkles, Wallet } from "@/components/icons";
import { onAppEvent } from "@/lib/app-events";
import {
  CREDIT_PACKS,
  FEATURES,
  PLANS,
  VIDEO_PACKS,
  planAllows,
  planRank,
  type BillingInterval,
  type PaidPlanId,
} from "@/lib/billing/catalog";
import {
  asFeature,
  asPlan,
  formatMeter,
  formatNumber,
  formatUsd,
  nextPlan,
  planPrice,
  suggestedPlan,
  type BillingBlock,
} from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { cn } from "@/lib/utils";
import { DoneNote, GhostButton, IntervalToggle, PlanCard, PrimaryButton } from "./billing-ui";
import { useBillingActions, type PurchaseKind } from "./use-billing-actions";

const PAID: PaidPlanId[] = ["starter", "growth", "agency", "scale"];

type View = "plans" | "credits";
type Pending = { kind: PurchaseKind; key: string; label: string; price: string };

export function UpgradeDialog() {
  const [open, setOpen] = useState(false);
  const [block, setBlock] = useState<BillingBlock | null>(null);
  const [view, setView] = useState<View>("plans");
  const [interval, setBillingInterval] = useState<BillingInterval>("year");
  const [pending, setPending] = useState<Pending | null>(null);
  const [contact, setContact] = useState("");
  const [sent, setSent] = useState<Pending | null>(null);
  const { data, isLoading } = useEntitlements({ enabled: open });
  const actions = useBillingActions(data);

  useEffect(
    () =>
      onAppEvent("open:upgrade", (event) => {
        const next = event.detail ?? null;
        setBlock(next);
        setView(next?.code === "insufficient_balance" ? "credits" : "plans");
        setPending(null);
        setSent(null);
        setOpen(true);
      }),
    [],
  );

  const current = asPlan(data?.entitledPlan);
  const feature = asFeature(block?.feature);
  // A reason (locked feature, limit, empty balance) picks the plan that fixes
  // it; a plain "Upgrade" recommends the most popular plan.
  const recommended = block
    ? suggestedPlan(block, current)
    : planRank("growth") > planRank(current)
      ? "growth"
      : nextPlan(current);
  const requestMode = data?.checkoutMode !== "card";
  const canBuy = Boolean(data?.isOwner);

  const title = useMemo(() => {
    if (sent) return "Request sent";
    if (view === "credits") return "Get more credits";
    if (feature) return `Unlock ${FEATURES[feature].label}`;
    if (block?.code === "limit_reached") return "You've reached your plan limit";
    if (block?.code === "brand_frozen") return "This brand is paused";
    return "Upgrade your plan";
  }, [sent, view, feature, block]);

  const description = sent
    ? undefined
    : view === "plans" && feature
      ? FEATURES[feature].pitch
      : view === "plans"
        ? "Pick the plan that fits your team."
        : "One-time packs. They never expire.";

  async function choose(item: Pending) {
    if (!requestMode) {
      await actions.purchase({
        kind: item.kind,
        key: item.key,
        interval: item.kind === "plan" ? interval : undefined,
      });
      return;
    }
    setPending(item);
  }

  async function sendRequest() {
    if (!pending) return;
    const outcome = await actions.purchase({
      kind: pending.kind,
      key: pending.key,
      interval: pending.kind === "plan" ? interval : undefined,
      contact,
    });
    if (outcome === "requested") {
      setSent(pending);
      setPending(null);
    }
  }

  const planAction = (plan: PaidPlanId) => {
    if (!data) return null;
    if (plan === current) {
      return (
        <GhostButton className="w-full" disabled>
          Your plan
        </GhostButton>
      );
    }
    if (planRank(plan) < planRank(current)) {
      return (
        <p className="flex h-10 items-center justify-center text-[12.5px] text-muted-foreground">
          In your plan
        </p>
      );
    }
    if (feature && !planAllows(plan, feature)) {
      return (
        <p className="flex h-10 items-center justify-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5" /> No {FEATURES[feature].label}
        </p>
      );
    }
    if (!canBuy) return <div className="h-10" />;
    const Button = plan === recommended ? PrimaryButton : GhostButton;
    const price = planPrice(plan, interval);
    return (
      <Button
        className="w-full"
        disabled={actions.busy !== null}
        onClick={() =>
          void choose({
            kind: "plan",
            key: plan,
            label: `${PLANS[plan].label} plan`,
            price:
              interval === "year"
                ? `${formatUsd(price.billed)} a year`
                : `${formatUsd(price.billed)} a month`,
          })
        }
      >
        {actions.busy === plan ? "One moment…" : `Upgrade to ${PLANS[plan].label}`}
      </Button>
    );
  };

  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      title={title}
      description={description}
      Icon={view === "credits" ? Wallet : feature ? Lock : Crown}
      size={pending || sent ? "sm" : "xl"}
      // Fit the content instead of the tall fixed window.
      contentClassName="sm:h-fit"
    >
      <div className="px-5 pb-6 pt-2 sm:px-6">
        {isLoading && !data && (
          <div className="grid gap-3 md:grid-cols-4">
            {PAID.map((plan) => (
              <Skeleton key={plan} className="h-80 rounded-2xl" />
            ))}
          </div>
        )}

        {data && sent && (
          <div className="space-y-4">
            <DoneNote title={`We got your request for the ${sent.label}`}>
              We'll email you to finish payment.{" "}
              {sent.kind === "plan" ? "Your plan switches on" : "It's added"} as soon as it's paid.
            </DoneNote>
            <PrimaryButton className="w-full" onClick={() => setOpen(false)}>
              Done
            </PrimaryButton>
          </div>
        )}

        {data && pending && !sent && (
          <div className="space-y-4">
            <div className="ds-tile flex items-center justify-between gap-3 p-4">
              <div>
                <p className="text-[15px] font-semibold">{pending.label}</p>
                <p className="text-[13px] text-muted-foreground">{pending.price}</p>
              </div>
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <p className="text-[13.5px] text-muted-foreground">
              Card payment is coming soon. Send a request and we'll email you to pay.{" "}
              {pending.kind === "plan"
                ? "Your plan switches on as soon as it's paid."
                : "The pack is added as soon as it's paid."}
            </p>
            <input
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              maxLength={120}
              placeholder="Phone or WhatsApp (optional)"
              aria-label="Phone or WhatsApp (optional)"
              className="h-10 w-full rounded-full bg-[var(--ds-well-bg)] px-4 text-[13.5px] outline-none ring-primary/40 placeholder:text-muted-foreground focus-visible:ring-2"
            />
            <div className="flex gap-2">
              <GhostButton onClick={() => setPending(null)}>Back</GhostButton>
              <PrimaryButton
                className="flex-1"
                disabled={actions.busy !== null}
                onClick={() => void sendRequest()}
              >
                {actions.busy ? "Sending…" : "Send request"}
              </PrimaryButton>
            </div>
          </div>
        )}

        {data && !pending && !sent && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                role="tablist"
                aria-label="What to buy"
                className="inline-flex rounded-full bg-[var(--ds-well-bg)] p-1 text-[13px]"
              >
                {(
                  [
                    ["plans", "Plans"],
                    ["credits", "Credit packs"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={view === id}
                    onClick={() => setView(id)}
                    className={cn(
                      "h-8 rounded-full px-4 font-medium transition-colors",
                      view === id
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {view === "plans" && (
                <IntervalToggle value={interval} onChange={setBillingInterval} />
              )}
            </div>

            {block?.code === "insufficient_balance" && view === "credits" && !!block.needed && (
              <p className="text-[13.5px] text-muted-foreground">
                This needs {formatMeter(block.meter ?? "credits", block.needed ?? 0)}. You have{" "}
                {formatMeter(block.meter ?? "credits", block.available ?? 0)} left.
              </p>
            )}
            {block?.code === "limit_reached" &&
              view === "plans" &&
              typeof block.max === "number" && (
                <p className="text-[13.5px] text-muted-foreground">
                  You're using {formatNumber(block.used ?? 0)} of {formatNumber(block.max)} on your{" "}
                  {PLANS[current].label} plan. A bigger plan gives you more room.
                </p>
              )}

            {view === "plans" ? (
              <div className="grid gap-4 pt-2 sm:grid-cols-2 lg:grid-cols-4">
                {PAID.map((plan) => (
                  <PlanCard
                    key={plan}
                    plan={plan}
                    interval={interval}
                    current={plan === current}
                    recommended={plan === recommended && plan !== current}
                    // On a phone the recommended plan comes first.
                    className={plan === recommended ? "order-first sm:order-none" : undefined}
                    dimmed={
                      planRank(plan) < planRank(current) ||
                      Boolean(feature && !planAllows(plan, feature))
                    }
                    action={planAction(plan)}
                  />
                ))}
              </div>
            ) : (
              <CreditPacks
                canBuy={canBuy}
                busy={actions.busy}
                showVideos={block?.meter === "video" || PLANS[current].allowances.videoUnits > 0}
                onChoose={(item) => void choose(item)}
              />
            )}

            {view === "plans" && (
              <p className="text-center text-[12px] text-muted-foreground">
                Prices in US dollars. Change or cancel any time.
              </p>
            )}

            {!canBuy && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--ds-radius-tile)] bg-[var(--ds-well-bg)] p-4 text-[13.5px]">
                <span>Only the account owner can upgrade this brand's plan.</span>
                {actions.sent.has("ask-owner") ? (
                  <span className="font-medium text-primary">Sent to the owner</span>
                ) : (
                  <PrimaryButton
                    className="h-9"
                    disabled={actions.busy !== null}
                    onClick={() =>
                      void actions.askOwner({
                        feature: block?.feature ?? block?.limit ?? block?.meter,
                        requiredPlan: recommended ?? undefined,
                      })
                    }
                  >
                    Ask the owner
                  </PrimaryButton>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </AppModalShell>
  );
}

function CreditPacks({
  canBuy,
  busy,
  showVideos,
  onChoose,
}: {
  canBuy: boolean;
  busy: string | null;
  showVideos: boolean;
  onChoose: (item: Pending) => void;
}) {
  const rows: Array<Pending & { title: string; extra?: string }> = [
    ...CREDIT_PACKS.map((pack) => ({
      kind: "credit_pack" as const,
      key: pack.key,
      title: formatMeter("credits", pack.credits + pack.bonusCredits),
      extra: pack.bonusCredits ? `includes ${formatNumber(pack.bonusCredits)} bonus` : undefined,
      label: `${formatMeter("credits", pack.credits + pack.bonusCredits)} pack`,
      price: formatUsd(pack.usd),
    })),
    ...(showVideos
      ? VIDEO_PACKS.map((pack) => ({
          kind: "video_pack" as const,
          key: pack.key,
          title: formatMeter("video", pack.videoUnits),
          extra: undefined,
          label: `${formatMeter("video", pack.videoUnits)} pack`,
          price: formatUsd(pack.usd),
        }))
      : []),
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map((row) => (
        <div key={row.key} className="ds-tile flex flex-col gap-3 p-4">
          <div>
            <p className="text-[16px] font-semibold tabular-nums">{row.title}</p>
            <p className="h-4 text-[12px] text-muted-foreground">{row.extra ?? ""}</p>
          </div>
          <p className="text-[22px] font-semibold tabular-nums">{row.price}</p>
          {canBuy && (
            <GhostButton className="w-full" disabled={busy !== null} onClick={() => onChoose(row)}>
              {busy === row.key ? "One moment…" : "Buy"}
            </GhostButton>
          )}
        </div>
      ))}
    </div>
  );
}
