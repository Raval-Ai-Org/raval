"use client";

// The upgrade window, as pure presentation: what you unlock on the left, a
// short plan list with one button on the right. `UpgradeDialog` feeds it real
// data; `/upgrade-lab` renders it with sample data in development.
//
// One plan is always picked (the one that fixes what the person ran into), so
// the screen has a single lime action instead of a button per plan.

import { useState, type ReactNode } from "react";
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
  type LucideIcon,
} from "@/components/icons";
import {
  CREDIT_ACTIONS,
  CREDIT_PACKS,
  FEATURES,
  PLANS,
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
  formatVideos,
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
  const open = PAID.filter(
    (plan) => planRank(plan) > planRank(current) && (!feature || planAllows(plan, feature)),
  );
  const [picked, setPicked] = useState<PaidPlanId | null>(
    recommended && open.includes(recommended) ? recommended : (open[0] ?? null),
  );
  const packs = packRows(props.showVideoPacks);
  const [pack, setPack] = useState(() => startingPack(packs, block));

  return (
    <div className="relative flex flex-col lg:grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 hidden w-[380px] overflow-hidden border-r border-border/50 bg-[var(--ds-well-bg)] lg:block"
      >
        <Glow />
      </div>

      <div className="relative order-1 overflow-hidden px-5 pb-1 pt-6 sm:px-7 lg:pt-7">
        <div aria-hidden className="pointer-events-none absolute inset-0 lg:hidden">
          <Glow />
        </div>
        <Hero {...props} feature={feature} />
      </div>

      <div className="relative order-3 px-5 pb-6 pt-4 sm:px-7 lg:order-2 lg:pb-7">
        {view === "plans" ? (
          <PlanDetails key={picked ?? current} plan={picked ?? current} />
        ) : (
          <CreditFacts balance={props.balance} onPlans={() => props.onViewChange("plans")} />
        )}
      </div>

      <div className="order-2 flex flex-col gap-4 px-5 pb-2 pt-5 sm:px-7 lg:order-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:justify-center lg:pb-7 lg:pt-7">
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
            <IntervalToggle value={interval} onChange={props.onIntervalChange} />
          )}
        </div>

        {view === "plans" ? (
          <>
            <div role="radiogroup" aria-label="Plans" className="flex flex-col gap-2">
              {PAID.filter((plan) => planRank(plan) >= planRank(current)).map((plan) => (
                <PlanRow
                  key={plan}
                  plan={plan}
                  interval={interval}
                  selected={plan === picked}
                  current={plan === current}
                  lockedFor={feature && !planAllows(plan, feature) ? feature : null}
                  badge={
                    plan === current
                      ? null
                      : plan === recommended && feature
                        ? `Unlocks ${FEATURES[feature].label}`
                        : plan === recommended
                          ? "Recommended"
                          : (PLANS[plan].badge ?? null)
                  }
                  onSelect={() => setPicked(plan)}
                />
              ))}
            </div>
            {picked ? (
              <PlanAction {...props} plan={picked} />
            ) : (
              <p className="text-center text-[13px] text-muted-foreground">
                You're on our biggest plan.
              </p>
            )}
          </>
        ) : (
          <>
            <PackGrid rows={packs} selected={pack} onSelect={setPack} />
            <PackAction {...props} row={packs.find((row) => row.key === pack) ?? packs[0]} />
          </>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── left side ───────────────────────────── */

function Glow() {
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(110%_60%_at_0%_0%,hsl(var(--primary)/0.2),transparent_62%)]" />
      <svg
        viewBox="0 0 200 200"
        className="absolute -right-20 -top-20 h-72 w-72 text-primary"
        fill="none"
        stroke="currentColor"
      >
        {[38, 60, 82, 99].map((r, i) => (
          <circle key={r} cx="100" cy="100" r={r} strokeOpacity={0.3 - i * 0.07} />
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
  let Icon: LucideIcon = Crown;
  let tag: string | null = null;
  let title = "Get more done with Mellox";
  let text = "More content, more videos and the tools that do the work for you.";

  if (view === "credits") {
    Icon = Wallet;
    title = "Get more credits";
    text = "One-time packs. They never expire.";
    if (block?.code === "insufficient_balance" && block.needed) {
      const meter = block.meter ?? "credits";
      title = meter === "video" ? "You're out of videos" : "You're out of credits";
      text = `This needs ${formatMeter(meter, block.needed)}. You have ${formatMeter(meter, block.available ?? 0)} left.`;
    }
  } else if (feature) {
    Icon = featureIcon(feature);
    tag = `On the ${PLANS[FEATURES[feature].minPlan].label} plan`;
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
    <div className="relative">
      <div className="flex items-center gap-2.5">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_10px_28px_-10px_hsl(var(--primary)/0.8)]">
          <Icon className="h-5 w-5" strokeWidth={2.2} />
        </span>
        {tag && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2.5 py-1 text-[11.5px] font-semibold text-primary">
            <Lock className="h-3 w-3" strokeWidth={2.4} aria-hidden />
            {tag}
          </span>
        )}
      </div>
      <h3 className="mt-4 text-[24px] font-semibold leading-[1.15] tracking-tight">{title}</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}

function PlanDetails({ plan }: { plan: PlanId }) {
  const def = PLANS[plan];
  const below = PAID[PAID.indexOf(plan as PaidPlanId) - 1];
  const stats: Array<{ Icon: LucideIcon; value: string; label: string }> = [
    {
      Icon: Building2,
      value: formatNumber(def.brands),
      label: def.brands === 1 ? "brand" : "brands",
    },
    {
      Icon: Users,
      value: def.seats === null ? "Unlimited" : formatNumber(def.seats),
      label: "team seats",
    },
    {
      Icon: Bolt,
      value: formatNumber(def.allowances.credits),
      label: def.allowances.credits
        ? `credits · ~${formatNumber(postsFrom(def.allowances.credits))} posts`
        : "credits",
    },
    {
      Icon: Video,
      value: formatVideos(def.allowances.videoUnits),
      label: "videos",
    },
  ];
  return (
    <div className="ds-enter" data-testid="plan-details">
      <p className="ds-label">Each month on {def.label}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="ds-tile px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-[17px] font-semibold leading-tight tabular-nums">
              <stat.Icon className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.2} />
              {stat.value}
            </p>
            <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>
      <p className="ds-label mt-5">
        {below ? `Everything in ${PLANS[below].label}, plus` : "What you can do"}
      </p>
      <ul className="mt-3 space-y-2 text-[13px]">
        {def.highlights.map((line) => (
          <li key={line} className="flex gap-2">
            <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
            <span className="text-[13px] leading-[18px] text-foreground/85">{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CreditFacts({ balance, onPlans }: { balance: number; onPlans: () => void }) {
  return (
    <div className="ds-enter">
      <div className="ds-tile flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-[13px] text-muted-foreground">You have</span>
        <span className="text-[17px] font-semibold tabular-nums">
          {formatMeter("credits", balance)}
        </span>
      </div>
      <ul className="mt-4 space-y-2 text-[13px]">
        {[
          "They never expire",
          "They work across all your brands",
          "Bigger packs include bonus credits",
        ].map((line) => (
          <li key={line} className="flex gap-2">
            <span className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
              <Check className="h-2.5 w-2.5" strokeWidth={3} />
            </span>
            <span className="text-[13px] leading-[18px] text-foreground/85">{line}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onPlans}
        className="mt-5 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
      >
        Get credits every month with a plan
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ───────────────────────────── right side ───────────────────────────── */

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

function PlanRow({
  plan,
  interval,
  selected,
  current,
  lockedFor,
  badge,
  onSelect,
}: {
  plan: PaidPlanId;
  interval: BillingInterval;
  selected: boolean;
  current: boolean;
  lockedFor: FeatureKey | null;
  badge: string | null;
  onSelect: () => void;
}) {
  const def = PLANS[plan];
  const price = planPrice(plan, interval);
  const disabled = current || Boolean(lockedFor);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      data-testid={`plan-${plan}`}
      className={cn(
        optionBase,
        "px-4 py-3",
        selected ? optionOn : !disabled && optionOff,
        disabled && "opacity-55",
      )}
    >
      <RadioDot on={selected} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[15px] font-semibold">{def.label}</span>
          {current && (
            <span className="rounded-full bg-foreground px-2 py-0.5 text-[10.5px] font-semibold text-background">
              Your plan
            </span>
          )}
          {badge && !lockedFor && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10.5px] font-semibold text-primary-foreground">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted-foreground">
          {lockedFor ? (
            <>
              <Lock className="h-3 w-3" aria-hidden /> No {FEATURES[lockedFor].label}
            </>
          ) : (
            def.fit
          )}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="flex items-baseline justify-end gap-1.5">
          {interval === "year" && (
            <span className="text-[12.5px] text-muted-foreground line-through tabular-nums">
              {formatUsd(def.priceMonthlyUsd)}
            </span>
          )}
          <span className="text-[20px] font-semibold tracking-tight tabular-nums">
            {formatUsd(Math.round(price.perMonth))}
          </span>
        </span>
        <span className="block text-[11.5px] text-muted-foreground">a month</span>
      </span>
    </button>
  );
}

function Reassurance({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground">
      <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
      {children}
    </p>
  );
}

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

function PlanAction({
  plan,
  interval,
  canBuy,
  busy,
  askSent,
  onChoose,
  onAskOwner,
  onIntervalChange,
}: UpgradeScreenProps & { plan: PaidPlanId }) {
  const def = PLANS[plan];
  const price = planPrice(plan, interval);
  const yearlySaving = planPrice(plan, "year").savings;
  if (!canBuy) {
    return <OwnerOnly askSent={askSent} busy={busy !== null} onAsk={() => onAskOwner(plan)} />;
  }
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="text-muted-foreground">
          {interval === "year" ? `${formatUsd(price.billed)} billed yearly` : "Billed monthly"}
        </span>
        {interval === "year" ? (
          <span className="rounded-full bg-primary/12 px-2.5 py-0.5 text-[12px] font-semibold text-primary">
            You save {formatUsd(price.savings)}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onIntervalChange("year")}
            className="font-medium text-primary hover:underline"
          >
            Pay yearly, save {formatUsd(yearlySaving)}
          </button>
        )}
      </div>
      <PrimaryButton
        className="h-12 w-full text-[15px]"
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
        {busy !== plan && <ArrowRight className="h-4 w-4" />}
      </PrimaryButton>
      <Reassurance>Change or cancel any time · Prices in US dollars</Reassurance>
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
      <Reassurance>One-time payment · Never expires</Reassurance>
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
        <div className="grid gap-6 p-6 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-72 rounded-2xl" />
          <div className="space-y-2">
            {PAID.map((plan) => (
              <Skeleton key={plan} className="h-[68px] rounded-2xl" />
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
