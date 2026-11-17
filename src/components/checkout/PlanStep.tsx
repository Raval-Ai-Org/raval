"use client";

// Step 1, Plan: why the person is here, Monthly / Yearly, the three plans as
// Holo-style cards (the recommended one framed in the Mox gradient), Enterprise
// as a slim row, and credit packs on their own tab. Presentational.

import Image from "next/image";
import {
  ArrowRight,
  Bolt,
  Building2,
  Check,
  Crown,
  MessageSquare,
  PenLine,
  Rocket,
  Sparkles,
  Wallet,
  X,
  type LucideIcon,
} from "@/components/icons";
import {
  CREDIT_PACKS,
  FEATURES,
  PLANS,
  PUBLIC_PLANS,
  annualMonthlyUsd,
  creditsOf,
  planAllows,
  planRank,
  type BillingInterval,
  type PaidPlanId,
  type PlanId,
} from "@/lib/billing/catalog";
import type { CheckoutItem } from "@/lib/billing/checkout-link";
import { planOutcomes } from "@/lib/billing/plan-economics";
import {
  asFeature,
  formatMeter,
  formatNumber,
  formatUsd,
  planPrice,
  type BillingBlock,
} from "@/lib/billing/present";
import { cn } from "@/lib/utils";
import { CtaButton, MOX, OutlineButton, PromiseRow } from "./checkout-parts";

const PLAN_ICON: Record<PaidPlanId, LucideIcon> = {
  starter: Bolt,
  growth: Rocket,
  agency: Building2,
  scale: Crown,
};

export type PlanStepProps = {
  current: PlanId;
  view: "plans" | "credits";
  onViewChange: (view: "plans" | "credits") => void;
  interval: BillingInterval;
  onIntervalChange: (interval: BillingInterval) => void;
  recommended: PaidPlanId | null;
  block: BillingBlock | null;
  /** Only the account owner buys; a teammate asks the owner. */
  canBuy: boolean;
  /** Stripe has passed the server's readiness checks. */
  paymentsAvailable: boolean;
  askSent: boolean;
  busy: boolean;
  balance: number;
  onPick: (item: CheckoutItem) => void;
  onAskOwner: (plan: PaidPlanId | null) => void;
};

function heroCopy(block: BillingBlock | null, current: PlanId, view: "plans" | "credits") {
  const free = current === "free";
  const feature = asFeature(block?.feature);
  if (view === "credits")
    return {
      eyebrow: "Top up",
      title: block?.code === "insufficient_balance" ? "You're out of credits" : "Get more credits",
      text: "One-time packs for every brand on your account, valid for 12 months.",
    };
  if (feature)
    return {
      eyebrow: `Unlock ${FEATURES[feature].label}`,
      title: `${FEATURES[feature].label}, unlocked`,
      text: FEATURES[feature].pitch,
    };
  if (block?.code === "insufficient_balance")
    return {
      eyebrow: "Keep creating",
      title: free ? "Pick a plan to keep creating" : "More credits, every month",
      text: "Your plan's credits refill every month and unused ones roll over a month.",
    };
  if (block?.code === "limit_reached")
    return {
      eyebrow: "More room",
      title: block.limit === "brands" ? "Add another brand" : "You've hit your plan's limit",
      text: "A bigger plan gives you more brands, more credits and more of everything.",
    };
  return {
    eyebrow: free ? "Start with Mellox" : "Upgrade",
    title: free ? "Marketing that runs itself" : "Get more room to grow",
    text: `Posts, carousels, Stories, ads, articles and videos, with Autopilot, the four brains and AI visibility. From ${formatUsd(annualMonthlyUsd("starter"))} a month.`,
  };
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<readonly [T, React.ReactNode]>;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex rounded-full border border-foreground/[0.07] bg-background/80 p-1 text-[13px] shadow-sm backdrop-blur"
    >
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-4 font-semibold transition-all duration-300",
            value === id
              ? "bg-foreground text-background shadow"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function PlanCard(props: PlanStepProps & { plan: PaidPlanId; featured: boolean; index: number }) {
  const { plan, featured, interval, current, block, index } = props;
  const def = PLANS[plan];
  const price = planPrice(plan, interval);
  const made = planOutcomes(plan);
  const Icon = PLAN_ICON[plan];
  const feature = asFeature(block?.feature);
  const missing = feature && !planAllows(plan, feature) ? feature : null;
  const below = PUBLIC_PLANS[PUBLIC_PLANS.indexOf(plan as (typeof PUBLIC_PLANS)[number]) - 1];
  const isCurrent = plan === current;

  const facts: Array<{ Icon: LucideIcon; text: string }> = [
    {
      Icon: Bolt,
      text: `${formatNumber(creditsOf(def.allowances.credits))} credits a month · about ${formatNumber(made.imagePosts)} image posts`,
    },
    { Icon: PenLine, text: "Unlimited text posts and publishing" },
    {
      Icon: MessageSquare,
      text: `${formatNumber(def.allowances.proMessages)} Mellox Pro messages`,
    },
    {
      Icon: Building2,
      text: `${formatNumber(def.brands)} ${def.brands === 1 ? "brand" : "brands"} · ${def.seats === null ? "unlimited seats" : `${formatNumber(def.seats)} seats`}`,
    },
  ];

  return (
    <div
      data-testid={`plan-${plan}`}
      data-recommended={featured}
      className={cn(
        "checkout-rise relative flex flex-col rounded-[26px]",
        featured
          ? "checkout-frame shadow-[0_30px_60px_-30px_rgb(63_228_110/0.6)] max-lg:order-first lg:-mt-3"
          : "border border-foreground/[0.08] bg-card shadow-[0_18px_40px_-30px_rgb(0_0_0/0.35)]",
      )}
      style={{ animationDelay: `${80 + index * 70}ms` }}
    >
      {featured && (
        <div className="checkout-cta -mx-px -mt-px rounded-t-[24px] py-1.5 text-center text-[11.5px] font-bold tracking-wide">
          {feature ? `Unlocks ${FEATURES[feature].label}` : "Most popular"}
        </div>
      )}
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "grid h-9 w-9 place-items-center rounded-xl",
              featured ? "checkout-cta" : "bg-foreground/[0.06] text-foreground",
            )}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </span>
          <span className="text-[17px] font-semibold">{def.label}</span>
          {isCurrent && (
            <span className="rounded-full bg-foreground px-2 py-0.5 text-[10.5px] font-semibold text-background">
              Your plan
            </span>
          )}
        </div>
        <p className="mt-2 text-[12.5px] text-muted-foreground">{def.tagline ?? def.fit}</p>

        <div className="mt-4 flex items-end gap-2">
          {interval === "year" && (
            <span className="pb-1 text-[15px] font-semibold text-[#e5484d] line-through tabular-nums">
              {formatUsd(def.priceMonthlyUsd)}
            </span>
          )}
          <span className="text-[34px] font-bold leading-none tracking-tight tabular-nums">
            {formatUsd(Math.round(price.perMonth))}
          </span>
          <span className="pb-1 text-[12.5px] text-muted-foreground">/month</span>
        </div>
        <div className="mt-2 flex min-h-6 flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          {interval === "year" ? (
            <>
              <span className="rounded-full bg-[#30a46c]/12 px-2 py-0.5 font-semibold text-[#218358] dark:text-[#3dd68c]">
                Save {formatUsd(price.savings)}
              </span>
              <span>{formatUsd(price.billed)} billed yearly</span>
            </>
          ) : (
            <button
              type="button"
              onClick={() => props.onIntervalChange("year")}
              className="font-medium text-foreground/80 underline-offset-2 hover:underline"
            >
              Save {formatUsd(planPrice(plan, "year").savings)} with yearly
            </button>
          )}
        </div>

        <PlanAction {...props} className="mt-4 h-11 w-full text-[14px]" />

        <div className="my-4 h-px bg-foreground/[0.07]" />
        <ul className="space-y-2">
          {facts.map((row) => (
            <li key={row.text} className="flex items-start gap-2.5 text-[12.5px] leading-[18px]">
              <row.Icon className="mt-px h-4 w-4 shrink-0 text-foreground/70" strokeWidth={2.1} />
              <span className="font-medium">{row.text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {below ? `Everything in ${PLANS[below].label}, and` : "What you can do"}
        </p>
        <ul className="mt-2 space-y-1.5">
          {def.highlights.slice(0, below ? 4 : 5).map((line) => (
            <li key={line} className="flex items-start gap-2 text-[12.5px] leading-[18px]">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#30a46c]" strokeWidth={3} />
              <span className="text-foreground/85">{line}</span>
            </li>
          ))}
          {missing && (
            <li className="flex items-start gap-2 text-[12.5px] leading-[18px] text-muted-foreground">
              <X className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={3} />
              {FEATURES[missing].label} is not included
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

function PlanAction(
  props: PlanStepProps & { plan: PaidPlanId; featured: boolean; className?: string },
) {
  const { plan, featured, current, canBuy, paymentsAvailable, askSent, busy, interval, className } =
    props;
  const Button = featured ? CtaButton : OutlineButton;
  if (plan === current)
    return (
      <OutlineButton className={className} disabled>
        Your current plan
      </OutlineButton>
    );
  if (!canBuy)
    return askSent ? (
      <p
        className={cn(
          "grid place-items-center text-[13px] font-semibold text-[#218358]",
          className,
        )}
      >
        Sent to the owner
      </p>
    ) : (
      <Button className={className} disabled={busy} onClick={() => props.onAskOwner(plan)}>
        Ask the owner
      </Button>
    );
  return (
    <Button
      className={className}
      disabled={busy || !paymentsAvailable}
      onClick={() => props.onPick({ kind: "plan", key: plan, interval })}
    >
      {paymentsAvailable
        ? planRank(current) > planRank("free")
          ? `Switch to ${PLANS[plan].label}`
          : `Get ${PLANS[plan].label}`
        : "Payments open soon"}
      {paymentsAvailable && <ArrowRight className="h-4 w-4" />}
    </Button>
  );
}

function EnterpriseRow(props: PlanStepProps) {
  const def = PLANS.scale;
  return (
    <div
      data-testid="plan-scale"
      className="checkout-rise flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[22px] border border-foreground/[0.08] bg-card/80 px-5 py-4"
      style={{ animationDelay: "320ms" }}
    >
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-foreground text-background">
        <Crown className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{def.label}</p>
        <p className="text-[12.5px] text-muted-foreground">
          {formatNumber(def.brands)}+ brands, SSO, API access and an SLA.
        </p>
      </div>
      <a
        href="mailto:hello@mellox.ai?subject=Mellox%20Enterprise"
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-foreground/15 px-4 text-[13px] font-semibold transition hover:border-foreground/35"
      >
        Talk to us <ArrowRight className="h-3.5 w-3.5" />
      </a>
      {props.current === "scale" && <span className="sr-only">Your plan</span>}
    </div>
  );
}

function PackCards(props: PlanStepProps) {
  return (
    <div className="mx-auto grid w-full max-w-[880px] gap-4 sm:grid-cols-3">
      {CREDIT_PACKS.map((pack, index) => {
        const credits = creditsOf(pack.credits + pack.bonusCredits);
        const featured = index === 1;
        const Button = featured ? CtaButton : OutlineButton;
        return (
          <div
            key={pack.key}
            data-testid={`pack-${pack.key}`}
            className={cn(
              "checkout-rise flex flex-col rounded-[24px] p-5",
              featured ? "checkout-frame" : "border border-foreground/[0.08] bg-card",
            )}
            style={{ animationDelay: `${80 + index * 70}ms` }}
          >
            <span className="text-[12px] font-semibold text-muted-foreground">
              {featured ? "Best value" : "Credit pack"}
            </span>
            <span className="mt-2 text-[30px] font-bold leading-none tabular-nums">
              {formatNumber(credits)}
              <span className="ml-1.5 text-[13px] font-medium text-muted-foreground">credits</span>
            </span>
            <span className="mt-2 text-[12.5px] text-muted-foreground">
              About {formatNumber(credits)} image posts · ${(pack.usd / credits).toFixed(2)} each
            </span>
            {props.canBuy ? (
              <Button
                className="mt-5 h-11 w-full text-[14px]"
                disabled={props.busy || !props.paymentsAvailable}
                onClick={() => props.onPick({ kind: "credit_pack", key: pack.key })}
              >
                {props.paymentsAvailable ? `Buy for ${formatUsd(pack.usd)}` : "Payments open soon"}
              </Button>
            ) : (
              <OutlineButton
                className="mt-5 h-11 w-full text-[14px]"
                disabled={props.busy || props.askSent}
                onClick={() => props.onAskOwner(null)}
              >
                {props.askSent ? "Sent to the owner" : "Ask the owner"}
              </OutlineButton>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function PlanStep(props: PlanStepProps) {
  const { current, view, interval, recommended } = props;
  const copy = heroCopy(props.block, current, view);
  const cards = PUBLIC_PLANS.filter((plan) => planRank(plan) >= planRank(current));
  const featured =
    recommended && cards.includes(recommended as (typeof PUBLIC_PLANS)[number])
      ? recommended
      : cards.includes("growth")
        ? "growth"
        : cards[0];

  return (
    <div className="flex flex-col gap-8">
      {/* Hero */}
      <div className="relative grid items-center gap-6 md:grid-cols-[1fr_auto]">
        <div className="checkout-rise min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/[0.08] bg-background/80 px-3 py-1 text-[12px] font-semibold shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-[#30a46c]" />
            {copy.eyebrow}
          </span>
          <h1 className="mt-3 text-[30px] font-bold leading-[1.08] tracking-tight sm:text-[40px]">
            {copy.title}
          </h1>
          <p className="mt-3 max-w-[560px] text-[14px] leading-relaxed text-muted-foreground">
            {copy.text}
          </p>
          {view === "credits" && (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-foreground/[0.05] px-3 py-1 text-[12.5px]">
              <Wallet className="h-3.5 w-3.5" />
              You have <b className="tabular-nums">{formatMeter("credits", props.balance)}</b>
            </p>
          )}
        </div>
        <div className="relative mx-auto h-[150px] w-[150px] max-md:hidden md:h-[190px] md:w-[190px]">
          <div className="absolute inset-4 rounded-full bg-[radial-gradient(closest-side,rgb(156_240_63/0.45),transparent)] blur-xl" />
          <Image
            src={MOX.visor}
            alt=""
            fill
            sizes="190px"
            priority
            className="checkout-float object-contain drop-shadow-[0_24px_30px_rgb(0_0_0/0.18)]"
          />
        </div>
      </div>

      {/* Switches */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="What to buy"
          value={view}
          onChange={props.onViewChange}
          options={[
            ["plans", "Plans"],
            ["credits", "Credit packs"],
          ]}
        />
        {view === "plans" && (
          <Segmented
            label="Billing period"
            value={interval}
            onChange={props.onIntervalChange}
            options={[
              ["month", "Monthly"],
              [
                "year",
                <>
                  Yearly
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-px text-[10.5px] font-bold",
                      interval === "year" ? "checkout-cta" : "bg-[#30a46c]/15 text-[#218358]",
                    )}
                  >
                    -20%
                  </span>
                </>,
              ],
            ]}
          />
        )}
      </div>

      {!props.paymentsAvailable && props.canBuy && (
        <p
          role="status"
          className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3 text-[13px]"
        >
          <b>Payments are being switched on.</b> Plans can't be bought for a moment. Nothing is
          charged; please try again shortly.
        </p>
      )}

      {view === "plans" ? (
        <>
          {cards.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-muted-foreground">
              You're on our biggest plan.
            </p>
          ) : (
            <div
              className={cn(
                "grid items-start gap-5 pt-3",
                cards.length === 3 && "lg:grid-cols-3",
                cards.length === 2 && "md:grid-cols-2",
                cards.length === 1 && "mx-auto w-full max-w-[400px]",
              )}
            >
              {cards.map((plan, index) => (
                <PlanCard
                  key={plan}
                  {...props}
                  plan={plan}
                  index={index}
                  featured={plan === featured}
                />
              ))}
            </div>
          )}
          <EnterpriseRow {...props} />
        </>
      ) : (
        <PackCards {...props} />
      )}

      <PromiseRow className="mt-2 rounded-[22px] border border-foreground/[0.06] bg-card/70 p-4" />
    </div>
  );
}
