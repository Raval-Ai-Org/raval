"use client";

// The upgrade screen. Opens only from a person's click (a locked feature, a
// "See options" toast button, an Upgrade button) with the reason attached,
// and offers the one plan or pack that fixes it.

import { useEffect, useState } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Skeleton } from "@/components/ui/skeleton";
import { Crown, Gauge, Lock, Users, Wallet } from "@/components/icons";
import { emitAppEvent, onAppEvent } from "@/lib/app-events";
import {
  CREDIT_PACKS,
  FEATURES,
  PLANS,
  TRIAL,
  VIDEO_PACKS,
  featuresGained,
  type BillingInterval,
  type PaidPlanId,
} from "@/lib/billing/catalog";
import {
  LIMIT_LABEL,
  addonForLimit,
  asFeature,
  asPlan,
  formatMeter,
  formatNumber,
  formatUsd,
  planPrice,
  suggestedPlan,
  type BillingBlock,
} from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";
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

function copyFor(block: BillingBlock | null) {
  const feature = asFeature(block?.feature);
  switch (block?.code) {
    case "upgrade_required":
      return {
        title: feature ? `Unlock ${FEATURES[feature].label}` : "Upgrade your plan",
        description: feature ? FEATURES[feature].pitch : undefined,
        Icon: Lock,
      };
    case "insufficient_balance":
      return {
        title:
          block.meter === "video"
            ? "Get more videos"
            : block.meter === "pro_messages"
              ? "Get more Pro messages"
              : "Get more credits",
        description: undefined,
        Icon: Wallet,
      };
    case "limit_reached":
      return {
        title: `Get more ${LIMIT_LABEL[block.limit ?? ""] ?? "room"}`,
        description: undefined,
        Icon: Gauge,
      };
    case "brand_frozen":
      return { title: "This brand is paused", description: undefined, Icon: Lock };
    case "spend_not_allowed":
      return { title: "You have view-only access", description: undefined, Icon: Users };
    default:
      return { title: "Upgrade your plan", description: undefined, Icon: Crown };
  }
}

export function UpgradeDialog() {
  const [open, setOpen] = useState(false);
  const [block, setBlock] = useState<BillingBlock | null>(null);
  const [interval, setBillingInterval] = useState<BillingInterval>("year");
  const [contact, setContact] = useState("");
  const { data, isLoading, error, refetch } = useEntitlements({ enabled: open });
  const { busy, sent, purchase, askOwner } = useBillingActions(data);

  useEffect(
    () =>
      onAppEvent("open:upgrade", (event) => {
        setBlock(event.detail ?? null);
        setOpen(true);
      }),
    [],
  );

  const { title, description, Icon } = copyFor(block);
  const current = asPlan(data?.entitledPlan);
  const target = suggestedPlan(block, current);
  const requestMode = data?.checkoutMode !== "card";
  const gained = target ? featuresGained(current, target).slice(0, 6) : [];
  const meter = block?.meter;
  const packs =
    block?.code === "insufficient_balance"
      ? meter === "video"
        ? VIDEO_PACKS.slice(0, 2).map((pack) => ({
            kind: "video_pack" as const,
            key: pack.key,
            title: formatMeter("video", pack.videoUnits),
            price: pack.usd,
            bonus: undefined as string | undefined,
          }))
        : meter === "credits"
          ? CREDIT_PACKS.slice(0, 2).map((pack) => ({
              kind: "credit_pack" as const,
              key: pack.key,
              title: formatMeter("credits", pack.credits + pack.bonusCredits),
              price: pack.usd,
              bonus: pack.bonusCredits ? `+${formatNumber(pack.bonusCredits)} bonus` : undefined,
            }))
          : []
      : [];
  const addon =
    block?.code === "limit_reached" && block.limit ? addonForLimit(current, block.limit) : null;
  const price = target ? planPrice(target, interval) : null;
  const canTrial =
    data?.isOwner &&
    !requestMode &&
    data.status === "free" &&
    !data.trial.used &&
    target === TRIAL.plan;

  const upgradeLabel =
    target && price
      ? `Upgrade to ${PLANS[target].label} · ${formatUsd(Math.round(price.perMonth))}/mo`
      : "Upgrade";

  async function upgrade(plan: PaidPlanId) {
    const outcome = await purchase({ kind: "plan", key: plan, interval, contact });
    if (outcome === "changed") setOpen(false);
  }

  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      title={title}
      description={description}
      Icon={Icon}
      size="md"
    >
      <div className="space-y-5 p-1">
        {isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-56 w-full rounded-2xl" />
          </div>
        )}
        {error && (
          <div className="ds-tile flex items-center justify-between gap-3 p-4 text-[13px]">
            <span>{error.message}</span>
            <GhostButton onClick={() => void refetch()}>Try again</GhostButton>
          </div>
        )}
        {data && (
          <>
            {block?.code === "insufficient_balance" && (
              <div className="ds-tile p-4">
                <UsageBar
                  label={`This needs ${formatMeter(meter ?? "credits", block.needed ?? 0)}`}
                  left={block.available ?? 0}
                  total={block.needed ?? 0}
                  leftText={`${formatMeter(meter ?? "credits", block.available ?? 0)} left`}
                  hint={
                    data.period.nextGrantAt && current !== "free"
                      ? `Your monthly allowance refills on ${new Date(data.period.nextGrantAt).toLocaleDateString()}.`
                      : undefined
                  }
                />
              </div>
            )}
            {block?.code === "limit_reached" && typeof block.max === "number" && (
              <div className="ds-tile p-4">
                <UsageBar
                  label={`Your ${PLANS[current].label} plan`}
                  left={Math.max(0, block.max - (block.used ?? 0))}
                  total={block.max}
                  leftText={`${formatNumber(block.used ?? 0)} of ${formatNumber(block.max)} used`}
                />
              </div>
            )}
            {block?.code === "brand_frozen" && (
              <p className="text-[13.5px] text-muted-foreground">
                Your plan includes {formatNumber(data.limits.brands)}{" "}
                {data.limits.brands === 1 ? "brand" : "brands"}. Everything here is saved. Upgrade,
                or choose which brands stay active.
              </p>
            )}

            {data.isOwner && packs.length > 0 && (
              <section className="space-y-2.5">
                <h4 className="ds-label">Top up now</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  {packs.map((pack) => (
                    <PackCard
                      key={pack.key}
                      title={pack.title}
                      subtitle="One time · never expires"
                      price={pack.price}
                      bonus={pack.bonus}
                      action={
                        sent.has(pack.key) ? (
                          <p className="text-[12.5px] font-medium text-primary">Request sent</p>
                        ) : (
                          <GhostButton
                            className="w-full"
                            disabled={busy !== null}
                            onClick={() =>
                              void purchase({ kind: pack.kind, key: pack.key, contact })
                            }
                          >
                            {busy === pack.key ? "One moment…" : requestMode ? "Request" : "Buy"}
                          </GhostButton>
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            {data.isOwner && addon && !requestMode && data.status === "active" && (
              <div className="ds-tile flex items-center justify-between gap-3 p-4 text-[13px]">
                <div>
                  <p className="font-semibold">{addon.label}</p>
                  <p className="text-muted-foreground">{formatUsd(addon.usdPerMonth)} a month</p>
                </div>
                <GhostButton onClick={() => emitAppEvent("open:usage", { tab: "topup" })}>
                  Add
                </GhostButton>
              </div>
            )}

            {target ? (
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="ds-label">
                    {packs.length ? "Or get more every month" : "Recommended"}
                  </h4>
                  <IntervalToggle value={interval} onChange={setBillingInterval} />
                </div>
                <PlanCard plan={target} interval={interval} highlighted compact />
                {gained.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {gained.map((feature) => (
                      <span
                        key={feature.key}
                        className="rounded-full bg-[var(--ds-well-bg)] px-2.5 py-1 text-[12px]"
                      >
                        {feature.label}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <p className="text-[13.5px] text-muted-foreground">
                You're on our largest plan. Write to us and we'll set up more for you.
              </p>
            )}

            {data.isOwner ? (
              target &&
              (sent.has(target) ? (
                <SentNote>
                  <p className="font-medium">Request sent</p>
                  <p className="text-muted-foreground">
                    We'll contact you to confirm payment and switch you to {PLANS[target].label}.
                  </p>
                </SentNote>
              ) : (
                <div className="space-y-3">
                  {requestMode && (
                    <input
                      value={contact}
                      onChange={(event) => setContact(event.target.value)}
                      maxLength={120}
                      placeholder="Phone or WhatsApp (optional)"
                      aria-label="Phone or WhatsApp (optional)"
                      className="h-10 w-full rounded-full bg-[var(--ds-well-bg)] px-4 text-[13.5px] outline-none ring-primary/40 placeholder:text-muted-foreground focus-visible:ring-2"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <PrimaryButton
                      className="flex-1"
                      disabled={busy !== null}
                      onClick={() => void upgrade(target)}
                    >
                      {busy === target ? "One moment…" : upgradeLabel}
                    </PrimaryButton>
                    {canTrial && (
                      <GhostButton
                        disabled={busy !== null}
                        onClick={() =>
                          void purchase({ kind: "plan", key: target, interval, trial: true })
                        }
                      >
                        Try free for {TRIAL.days} days
                      </GhostButton>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      emitAppEvent("open:usage", { tab: "plans" });
                    }}
                    className="w-full text-center text-[12.5px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Compare all plans
                  </button>
                </div>
              ))
            ) : sent.has("ask-owner") ? (
              <SentNote>
                <p className="font-medium">Sent to the owner</p>
                <p className="text-muted-foreground">They'll see your request in Plan & billing.</p>
              </SentNote>
            ) : (
              <div className="space-y-2">
                <p className="text-[13px] text-muted-foreground">
                  This brand uses its owner's plan. Only the owner can upgrade.
                </p>
                <PrimaryButton
                  className="w-full"
                  disabled={busy !== null}
                  onClick={() =>
                    void askOwner({
                      feature: block?.feature ?? block?.limit ?? block?.meter,
                      requiredPlan: target ?? undefined,
                    })
                  }
                >
                  {busy === "ask-owner" ? "Sending…" : "Ask the owner to upgrade"}
                </PrimaryButton>
              </div>
            )}
          </>
        )}
      </div>
    </AppModalShell>
  );
}
