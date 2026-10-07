"use client";

// The upgrade window, as pure presentation: why it opened on top, then the
// plans side by side, each with its price, what you get every month and its
// own button. `UpgradeDialog` feeds it real data; `/upgrade-lab` renders it
// with sample data in development.
//
// The plan that fixes what the person ran into is the highlighted one with the
// lime button. Every other plan stays buyable and says what it leaves out.

import { useState } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight,
  Bolt,
  Brain,
  Building2,
  Check,
  Crown,
  Eye,
  Gauge,
  Link,
  Lock,
  MessageSquare,
  PenLine,
  Rocket,
  Send,
  ShieldCheck,
  Users,
  Video,
  Wallet,
  X,
  type LucideIcon,
} from "@/components/icons";
import {
  CREDIT_ACTIONS,
  CREDIT_PACKS,
  FEATURES,
  PLANS,
  SIGNUP_GRANT,
  VIDEO_PACKS,
  planAllows,
  planRank,
  type BillingInterval,
  type FeatureKey,
  type FeatureModule,
  type PaidPlanId,
  type PlanId,
} from "@/lib/billing/catalog";
import {
  LIMIT_LABEL,
  asFeature,
  formatMeter,
  formatNumber,
  formatUsd,
  planPrice,
  type BillingBlock,
} from "@/lib/billing/present";
import { cn } from "@/lib/utils";
import { DoneNote, GhostButton, IntervalToggle, PrimaryButton } from "./billing-ui";
import type { PurchaseKind } from "./use-billing-actions";

export type UpgradeView = "plans" | "credits";
export type UpgradeChoice = { kind: PurchaseKind; key: string; label: string; price: string };

const PAID: PaidPlanId[] = ["starter", "growth", "agency", "scale"];

const MODULE_ICON: Record<FeatureModule, LucideIcon> = {
  Brand: Building2,
  Assistant: MessageSquare,
  Studio: PenLine,
  "UGC video": Video,
  "AI visibility": Eye,
  Intelligence: Brain,
  Distribution: Send,
  Team: Users,
};

function featureIcon(feature: FeatureKey): LucideIcon {
  if (feature === "autopilot") return Rocket;
  if (feature === "backlinks") return Link;
  return MODULE_ICON[FEATURES[feature].module];
}

/** Roughly how many posts a month of credits makes, rounded down. */
function postsFrom(credits: number): number {
  const posts = Math.floor(credits / CREDIT_ACTIONS.post_set.credits);
  const step = 10 ** Math.max(0, String(posts).length - 2);
  return Math.floor(posts / step) * step;
}

export type UpgradeScreenProps = {
  current: PlanId;
  /** Why the window opened (a lock, a limit, an empty balance), if anything. */
  block: BillingBlock | null;
  recommended: PaidPlanId | null;
  view: UpgradeView;
  onViewChange: (view: UpgradeView) => void;
  interval: BillingInterval;
  onIntervalChange: (interval: BillingInterval) => void;
  /** Only the account owner buys; everyone else can ask the owner. */
  canBuy: boolean;
  busy: string | null;
  askSent: boolean;
  /** Credits left right now. */
  balance: number;
  showVideoPacks: boolean;
  onChoose: (choice: UpgradeChoice) => void;
  onAskOwner: (plan: PaidPlanId | null) => void;
};

export function UpgradeScreen(props: UpgradeScreenProps) {
  const { current, block, recommended, view, interval } = props;
  const feature = asFeature(block?.feature);
  // Every plan from the current one up stays on screen and can be bought, even
  // when it doesn't include the feature the person clicked: it says so instead.
  const shown = PAID.filter((plan) => planRank(plan) >= planRank(current));
  const cards = shown.length > 3 ? shown.slice(0, 3) : shown;
  const extra = shown.length > 3 ? shown[3] : null;
  const packs = packRows(props.showVideoPacks);
  const [pack, setPack] = useState(() => startingPack(packs, block));

  const badgeFor = (plan: PaidPlanId) =>
    plan === current
      ? null
      : plan === recommended && feature
        ? `Unlocks ${FEATURES[feature].label}`
        : plan === recommended
          ? "Recommended"
          : null;

  return (
    <div className="relative flex flex-col gap-4 px-5 pb-6 pt-5 sm:px-7">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-56 overflow-hidden"
      >
        <Glow />
      </div>

      <Hero {...props} feature={feature} />

      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="What to buy"
          value={view}
          onChange={props.onViewChange}
          options={[
            ["plans", "Plans"],
            ["credits", "Credit packs"],
          ]}
        />
        {view === "plans" && <IntervalToggle value={interval} onChange={props.onIntervalChange} />}
      </div>

      {view === "plans" ? (
        <>
          {cards.length === 1 && cards[0] === current ? (
            <p className="py-6 text-center text-[13.5px] text-muted-foreground">
              You're on our biggest plan.
            </p>
          ) : (
            <div
              className={cn(
                "relative grid gap-3",
                cards.length === 3 ? "lg:grid-cols-3" : cards.length === 2 && "lg:grid-cols-2",
              )}
            >
              {cards.map((plan) => (
                <PlanCard
                  key={plan}
                  {...props}
                  plan={plan}
                  featured={plan === recommended}
                  badge={badgeFor(plan)}
                  missing={feature && !planAllows(plan, feature) ? feature : null}
                />
              ))}
            </div>
          )}
          {extra && <PlanStrip {...props} plan={extra} />}
          <Promises
            items={[
              "Change or cancel any time",
              "Keep everything you've made",
              "Prices in US dollars",
            ]}
          />
        </>
      ) : (
        <div className="relative mx-auto flex w-full max-w-[640px] flex-col gap-4">
          <CreditFacts balance={props.balance} />
          <PackGrid rows={packs} selected={pack} onSelect={setPack} />
          <PackAction {...props} row={packs.find((row) => row.key === pack) ?? packs[0]} />
          <button
            type="button"
            onClick={() => props.onViewChange("plans")}
            className="inline-flex items-center justify-center gap-1 text-[13px] font-medium text-primary hover:underline"
          >
            Get credits every month with a plan
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────────── the reason ───────────────────────────── */

function Glow() {
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(70%_100%_at_0%_0%,hsl(var(--primary)/0.16),transparent_70%)]" />
      <svg
        viewBox="0 0 200 200"
        className="absolute -right-16 -top-24 h-72 w-72 text-primary"
        fill="none"
        stroke="currentColor"
      >
        {[38, 60, 82, 99].map((r, i) => (
          <circle key={r} cx="100" cy="100" r={r} strokeOpacity={0.24 - i * 0.055} />
        ))}
      </svg>
    </>
  );
}

function Hero({
  current,
  block,
  view,
  feature,
}: UpgradeScreenProps & { feature: FeatureKey | null }) {
  const free = current === "free";
  let Icon: LucideIcon = Crown;
  let tag: string | null = null;
  let title = free ? "Do more with Mellox" : "Get more room to grow";
  let text = free
    ? `Free gives you ${formatNumber(SIGNUP_GRANT.credits)} credits once. A plan gives you ${formatNumber(PLANS.starter.allowances.credits)} or more every month, plus the tools that do the work for you.`
    : "More brands, more credits and more of the tools that do the work for you.";

  const empty = block?.code === "insufficient_balance";
  const meter = block?.meter ?? "credits";
  const need =
    empty && block?.needed
      ? `This needs ${formatMeter(meter, block.needed)}. You have ${formatMeter(meter, block.available ?? 0)} left. `
      : "";
  const outOf = meter === "video" ? "You're out of videos" : "You're out of credits";

  if (view === "credits") {
    Icon = Wallet;
    title = empty ? outOf : "Get more credits";
    text = `${need}One-time packs. They never expire.`;
  } else if (empty) {
    Icon = Bolt;
    title = free && meter === "credits" ? "You've used your free credits" : outOf;
    text = `${need}A plan refills your credits every month, so you never have to stop.`;
  } else if (feature) {
    const min = FEATURES[feature].minPlan;
    Icon = featureIcon(feature);
    tag = min === "scale" ? "On the Scale plan" : `On ${PLANS[min].label} and above`;
    title = `Unlock ${FEATURES[feature].label}`;
    text = FEATURES[feature].pitch;
  } else if (block?.code === "limit_reached") {
    Icon = Gauge;
    title = "You've reached your limit";
    text =
      typeof block.max === "number"
        ? `You're using ${formatNumber(block.used ?? 0)} of ${formatNumber(block.max)} ${LIMIT_LABEL[block.limit ?? ""] ?? ""} on ${PLANS[current].label}. A bigger plan gives you more room.`
        : "A bigger plan gives you more room.";
  } else if (block?.code === "brand_frozen") {
    Icon = Lock;
    title = "This brand is paused";
    text = "A bigger plan brings it back, with room for more brands.";
  }

  return (
    <div className="relative flex items-start gap-3.5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_10px_28px_-10px_hsl(var(--primary)/0.8)]">
        <Icon className="h-5 w-5" strokeWidth={2.2} />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h3 className="text-[21px] font-semibold leading-tight tracking-tight">{title}</h3>
          {tag && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2.5 py-0.5 text-[11.5px] font-semibold text-primary">
              <Lock className="h-3 w-3" strokeWidth={2.4} aria-hidden />
              {tag}
            </span>
          )}
        </div>
        <p className="mt-1 max-w-[680px] text-[13.5px] leading-relaxed text-muted-foreground">
          {text}
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────────── plans ───────────────────────────── */

function Tick() {
  return (
    <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
      <Check className="h-2.5 w-2.5" strokeWidth={3} />
    </span>
  );
}

/** A year's price as a daily figure: "$4.08". */
function perDay(yearUsd: number): string {
  return `$${(yearUsd / 365).toFixed(2)}`;
}

/** What a plan gives every month, as short lines. */
function planNumbers(plan: PlanId): Array<{ Icon: LucideIcon; main: string; note?: string }> {
  const def = PLANS[plan];
  return [
    {
      Icon: Bolt,
      main: `${formatNumber(def.allowances.credits)} credits a month`,
      note: `about ${formatNumber(postsFrom(def.allowances.credits))} posts`,
    },
    {
      Icon: Video,
      main: `${formatMeter("video", def.allowances.videoUnits)} a month`,
    },
    {
      Icon: Building2,
      main: `${formatNumber(def.brands)} ${def.brands === 1 ? "brand" : "brands"}`,
      note: def.seats === null ? "unlimited seats" : `${formatNumber(def.seats)} team seats`,
    },
  ];
}

function BuyButton({
  plan,
  featured,
  current,
  interval,
  canBuy,
  busy,
  askSent,
  onChoose,
  onAskOwner,
  className,
}: UpgradeScreenProps & { plan: PaidPlanId; featured: boolean; className?: string }) {
  const def = PLANS[plan];
  const price = planPrice(plan, interval);
  const Button = featured ? PrimaryButton : GhostButton;
  if (plan === current) {
    return (
      <GhostButton className={className} disabled>
        Your plan
      </GhostButton>
    );
  }
  if (!canBuy) {
    return askSent ? (
      <p className={cn("grid place-items-center text-[13px] font-medium text-primary", className)}>
        Sent to the owner
      </p>
    ) : (
      <Button className={className} disabled={busy !== null} onClick={() => onAskOwner(plan)}>
        Ask the owner
      </Button>
    );
  }
  return (
    <Button
      className={className}
      disabled={busy !== null}
      onClick={() =>
        onChoose({
          kind: "plan",
          key: plan,
          label: `${def.label} plan`,
          price: `${formatUsd(price.billed)} a ${interval}`,
        })
      }
    >
      {busy === plan ? "One moment…" : `Upgrade to ${def.label}`}
      {busy !== plan && featured && <ArrowRight className="h-4 w-4" />}
    </Button>
  );
}

function PlanCard(
  props: UpgradeScreenProps & {
    plan: PaidPlanId;
    featured: boolean;
    badge: string | null;
    missing: FeatureKey | null;
  },
) {
  const { plan, featured, badge, missing, current, interval, onIntervalChange } = props;
  const def = PLANS[plan];
  const price = planPrice(plan, interval);
  const yearlySaving = planPrice(plan, "year").savings;
  const below = PAID[PAID.indexOf(plan) - 1];
  return (
    <div
      data-testid={`plan-${plan}`}
      data-recommended={featured}
      className={cn(
        "ds-tile relative flex flex-col p-4",
        featured &&
          "border-primary bg-primary/[0.06] shadow-[0_0_0_1px_hsl(var(--primary)),0_18px_40px_-26px_hsl(var(--primary)/0.8)] max-lg:order-first",
      )}
    >
      <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[16px] font-semibold">{def.label}</span>
        {plan === current && (
          <span className="rounded-full bg-foreground px-2 py-0.5 text-[10.5px] font-semibold text-background">
            Your plan
          </span>
        )}
        {badge && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-[10.5px] font-semibold text-primary-foreground">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">{def.fit}</p>

      <p className="mt-3 flex items-baseline gap-1.5">
        {interval === "year" && (
          <span className="text-[13px] text-muted-foreground line-through tabular-nums">
            {formatUsd(def.priceMonthlyUsd)}
          </span>
        )}
        <span className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">
          {formatUsd(Math.round(price.perMonth))}
        </span>
        <span className="text-[12.5px] text-muted-foreground">a month</span>
      </p>
      <p className="mt-1.5 flex min-h-5 flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
        {interval === "year" ? (
          <>
            <span>
              {formatUsd(price.billed)} a year · {perDay(price.billed)} a day
            </span>
            <span className="rounded-full bg-primary/12 px-2 py-px font-semibold text-primary">
              Save {formatUsd(price.savings)}
            </span>
          </>
        ) : (
          <>
            Billed monthly
            <button
              type="button"
              onClick={() => onIntervalChange("year")}
              className="font-medium text-primary hover:underline"
            >
              Save {formatUsd(yearlySaving)} with yearly
            </button>
          </>
        )}
      </p>

      <BuyButton {...props} className="mt-3 h-10 w-full" />

      <ul className="mt-3.5 space-y-1.5 border-t border-border/50 pt-3.5 text-[13px]">
        {planNumbers(plan).map((row) => (
          <li key={row.main} className="flex items-center gap-2 whitespace-nowrap">
            <row.Icon className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.2} />
            <span className="text-[13px] font-semibold">{row.main}</span>
            {row.note && (
              <span className="truncate text-[12px] text-muted-foreground">· {row.note}</span>
            )}
          </li>
        ))}
      </ul>

      <p className="ds-label mt-3.5">
        {below ? `Everything in ${PLANS[below].label}, plus` : "What you can do"}
      </p>
      <ul className="mt-2 space-y-1.5">
        {def.highlights.map((line) => (
          <li key={line} className="flex gap-2">
            <Tick />
            <span className="text-[12.5px] leading-[18px] text-foreground/85">{line}</span>
          </li>
        ))}
        {missing && (
          <li className="flex gap-2 text-muted-foreground" data-testid={`missing-${plan}`}>
            <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-foreground/10">
              <X className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
            <span className="text-[12.5px] leading-[18px]">
              {FEATURES[missing].label} is not included
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

/** The biggest plan as one slim row under the three cards. */
function PlanStrip(props: UpgradeScreenProps & { plan: PaidPlanId }) {
  const { plan, interval } = props;
  const def = PLANS[plan];
  const price = planPrice(plan, interval);
  return (
    <div
      data-testid={`plan-${plan}`}
      className="ds-tile relative flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">
          {def.label}
          <span className="ml-2 text-[12.5px] font-normal text-muted-foreground">{def.fit}</span>
        </p>
        <p className="text-[12.5px] text-muted-foreground">
          {formatNumber(def.brands)} brands · {formatNumber(def.allowances.credits)} credits and{" "}
          {formatMeter("video", def.allowances.videoUnits)} a month · a dedicated account manager
        </p>
      </div>
      <p className="text-[14px] font-semibold tabular-nums">
        {formatUsd(Math.round(price.perMonth))}
        <span className="text-[12px] font-normal text-muted-foreground"> a month</span>
      </p>
      <BuyButton {...props} featured={false} className="h-9" />
    </div>
  );
}

function Promises({ items }: { items: string[] }) {
  return (
    <ul className="relative flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
      {items.map((item, index) => (
        <li key={item} className="flex items-center gap-1.5 text-[12px]">
          {index === 0 ? (
            <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
          ) : (
            <Check className="h-3 w-3 text-primary" strokeWidth={3} aria-hidden />
          )}
          {item}
        </li>
      ))}
    </ul>
  );
}

/* ───────────────────────────── credit packs ───────────────────────────── */

function CreditFacts({ balance }: { balance: number }) {
  return (
    <div className="ds-enter ds-tile flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
      <span className="text-[13px] text-muted-foreground">
        You have{" "}
        <span className="text-[15px] font-semibold text-foreground tabular-nums">
          {formatMeter("credits", balance)}
        </span>
      </span>
      <span className="text-[12.5px] text-muted-foreground">
        Packs work across all your brands. Bigger packs include bonus credits.
      </span>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex rounded-full bg-[var(--ds-well-bg)] p-1 text-[13px]"
    >
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "h-8 rounded-full px-4 font-medium transition-colors",
            value === id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function RadioDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition-colors",
        on ? "border-primary bg-primary text-primary-foreground" : "border-foreground/25",
      )}
    >
      {on && <Check className="h-2.5 w-2.5" strokeWidth={3.2} />}
    </span>
  );
}

const optionBase =
  "ds-tile flex w-full items-center gap-3 text-left transition-[border-color,background-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const optionOn =
  "border-primary bg-primary/[0.07] shadow-[0_0_0_1px_hsl(var(--primary)),0_14px_32px_-22px_hsl(var(--primary)/0.7)]";
const optionOff = "hover:border-[var(--ds-tile-border-hover)]";

function OwnerOnly({
  askSent,
  busy,
  onAsk,
}: {
  askSent: boolean;
  busy: boolean;
  onAsk: () => void;
}) {
  return (
    <div className="ds-well flex flex-wrap items-center justify-between gap-3 p-4 text-[13.5px]">
      <span>Only the account owner can buy this.</span>
      {askSent ? (
        <span className="font-medium text-primary">Sent to the owner</span>
      ) : (
        <PrimaryButton className="h-9" disabled={busy} onClick={onAsk}>
          Ask the owner
        </PrimaryButton>
      )}
    </div>
  );
}

type PackRow = UpgradeChoice & { title: string; bonus?: string; amount: number; meter: string };

function packRows(showVideos: boolean): PackRow[] {
  return [
    ...CREDIT_PACKS.map((item) => {
      const total = item.credits + item.bonusCredits;
      return {
        kind: "credit_pack" as const,
        key: item.key,
        meter: "credits",
        amount: total,
        title: formatMeter("credits", total),
        bonus: item.bonusCredits ? `+${formatNumber(item.bonusCredits)} bonus` : undefined,
        label: `${formatMeter("credits", total)} pack`,
        price: formatUsd(item.usd),
      };
    }),
    ...(showVideos
      ? VIDEO_PACKS.map((item) => ({
          kind: "video_pack" as const,
          key: item.key,
          meter: "video",
          amount: item.videoUnits,
          title: formatMeter("video", item.videoUnits),
          label: `${formatMeter("video", item.videoUnits)} pack`,
          price: formatUsd(item.usd),
        }))
      : []),
  ];
}

/** The smallest pack that covers what the blocked action still needs. */
function startingPack(rows: PackRow[], block: BillingBlock | null): string {
  const meter = block?.meter === "video" ? "video" : "credits";
  const missing = Math.max(0, (block?.needed ?? 0) - (block?.available ?? 0));
  const sameMeter = rows.filter((row) => row.meter === meter);
  return (sameMeter.find((row) => row.amount >= missing) ?? sameMeter[0] ?? rows[0]).key;
}

function PackGrid({
  rows,
  selected,
  onSelect,
}: {
  rows: PackRow[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Packs" className="grid grid-cols-2 gap-2">
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          role="radio"
          aria-checked={row.key === selected}
          onClick={() => onSelect(row.key)}
          data-testid={`pack-${row.key}`}
          className={cn(optionBase, "px-3.5 py-3", row.key === selected ? optionOn : optionOff)}
        >
          <RadioDot on={row.key === selected} />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold tabular-nums">{row.title}</span>
            <span className="block text-[12px] text-muted-foreground">
              {row.price}
              {row.bonus && <span className="font-medium text-primary"> · {row.bonus}</span>}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

function PackAction({
  row,
  canBuy,
  busy,
  askSent,
  onChoose,
  onAskOwner,
}: UpgradeScreenProps & { row: PackRow }) {
  if (!canBuy) {
    return <OwnerOnly askSent={askSent} busy={busy !== null} onAsk={() => onAskOwner(null)} />;
  }
  return (
    <div className="flex flex-col gap-2.5">
      <PrimaryButton
        className="h-12 w-full text-[15px]"
        disabled={busy !== null}
        onClick={() =>
          onChoose({ kind: row.kind, key: row.key, label: row.label, price: row.price })
        }
      >
        {busy === row.key ? "One moment…" : `Buy ${row.title} · ${row.price}`}
      </PrimaryButton>
      <Promises items={["One-time payment", "Never expires"]} />
    </div>
  );
}

/* ───────────────────────────── the window ───────────────────────────── */

export type UpgradeWindowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null while the plan is loading. */
  screen: UpgradeScreenProps | null;
  /** The request step, used until card payment is connected. */
  pending: UpgradeChoice | null;
  sent: UpgradeChoice | null;
  contact: string;
  onContactChange: (value: string) => void;
  onBack: () => void;
  onSend: () => void;
};

export function UpgradeWindow({
  open,
  onOpenChange,
  screen,
  pending,
  sent,
  contact,
  onContactChange,
  onBack,
  onSend,
}: UpgradeWindowProps) {
  const small = Boolean(screen && (pending || sent));
  return (
    <AppModalShell
      open={open}
      onOpenChange={onOpenChange}
      title={sent ? "Request sent" : screen?.view === "credits" ? "Get credits" : "Upgrade"}
      srDescription="Choose a plan or a credit pack."
      Icon={screen?.view === "credits" ? Wallet : Crown}
      size={small ? "sm" : "xl"}
      allowMaximize={false}
      // Fit the content instead of the tall fixed window.
      contentClassName="sm:h-fit sm:max-h-[92dvh]"
    >
      {!screen && (
        <div className="space-y-4 p-6">
          <Skeleton className="h-12 w-2/3 rounded-2xl" />
          <div className="grid gap-3 lg:grid-cols-3">
            {PAID.slice(0, 3).map((plan) => (
              <Skeleton key={plan} className="h-80 rounded-2xl" />
            ))}
          </div>
        </div>
      )}

      {screen && sent && (
        <div className="space-y-4 px-5 pb-6 pt-4 sm:px-6">
          <DoneNote title={`We got your request for the ${sent.label}`}>
            We'll email you to finish payment.{" "}
            {sent.kind === "plan" ? "Your plan switches on" : "It's added"} as soon as it's paid.
          </DoneNote>
          <PrimaryButton className="w-full" onClick={() => onOpenChange(false)}>
            Done
          </PrimaryButton>
        </div>
      )}

      {screen && pending && !sent && (
        <div className="space-y-4 px-5 pb-6 pt-4 sm:px-6">
          <div className="ds-tile flex items-center justify-between gap-3 border-primary/40 bg-primary/[0.07] p-4">
            <p className="text-[15px] font-semibold">{pending.label}</p>
            <p className="text-[15px] font-semibold tabular-nums">{pending.price}</p>
          </div>
          <ol className="grid grid-cols-3 gap-2 text-[12.5px]">
            {[
              "Send your request",
              "We email you to pay",
              pending.kind === "plan" ? "Your plan switches on" : "Your pack is added",
            ].map((step, index) => (
              <li key={step} className="ds-well flex flex-col gap-1.5 p-3">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                  {index + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
          <input
            value={contact}
            onChange={(event) => onContactChange(event.target.value)}
            maxLength={120}
            placeholder="Phone or WhatsApp (optional)"
            aria-label="Phone or WhatsApp (optional)"
            className="h-10 w-full rounded-full bg-[var(--ds-well-bg)] px-4 text-[13.5px] outline-none ring-primary/40 placeholder:text-muted-foreground focus-visible:ring-2"
          />
          <div className="flex gap-2">
            <GhostButton onClick={onBack}>Back</GhostButton>
            <PrimaryButton className="flex-1" disabled={screen.busy !== null} onClick={onSend}>
              {screen.busy ? "Sending…" : "Send request"}
            </PrimaryButton>
          </div>
        </div>
      )}

      {screen && !pending && !sent && (
        // A new reason or plan starts from that reason's own pick.
        <UpgradeScreen
          key={`${screen.block?.code ?? ""}:${screen.block?.feature ?? ""}:${screen.current}`}
          {...screen}
        />
      )}
    </AppModalShell>
  );
}
