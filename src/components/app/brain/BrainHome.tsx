"use client";
// BrainHome — the four brains feeding one strategy, at a glance.
// Presentational: everything it shows comes in as props (BrainOverview), so
// /brain-lab can render it with sample data.
//
// Layout note: blocks here are <div>s, not <section>s — the app's global
// rhythm rule adds a gap between sibling sections, which breaks a grid.
import { motion } from "framer-motion";
import { ArrowUpRight, Check, ChevronRight, Lock } from "@/components/icons";
import { dsFocus, dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import {
  BRAINS,
  BRAIN_META,
  ago,
  type BrainCard,
  type BrainId,
  type BrainOverview,
  type BrainSection,
  type BrainUpdate,
} from "@/lib/brain/brain";
import { cn } from "@/lib/utils";
import { BrainIcon, BrainMark } from "./BrainMark";

const EASE = [0.16, 1, 0.3, 1] as const;

export type BrainHomeProps = {
  overview: BrainOverview;
  /** Updates per brain this person hasn't seen yet. */
  news: Record<BrainId | "strategy", number>;
  /** Plan that unlocks a brain, when the current plan doesn't include it. */
  locked?: Partial<Record<BrainId, string>>;
  onOpen: (section: BrainSection) => void;
};

/** A ring that fills to `value` percent, with the number inside. */
function HealthRing({ value, color, locked }: { value: number; color: string; locked?: boolean }) {
  const size = 40;
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid h-10 w-10 shrink-0 place-items-center">
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        className="absolute inset-0 -rotate-90"
        aria-hidden
      >
        <circle
          cx={20}
          cy={20}
          r={r}
          fill="none"
          stroke="var(--ds-well-bg-hover)"
          strokeWidth={3.5}
        />
        <motion.circle
          cx={20}
          cy={20}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(100, value)) / 100) }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}
        />
      </svg>
      <span className="relative text-[11px] font-semibold tabular-nums leading-none text-foreground/80">
        {locked ? <Lock className="h-3.5 w-3.5" /> : value}
      </span>
    </span>
  );
}

function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10.5px] font-semibold leading-none text-primary-foreground">
      {count > 9 ? "9+" : count}
    </span>
  );
}

function BrainTile({
  brain,
  card,
  news,
  lockedPlan,
  index,
  onOpen,
}: {
  brain: BrainId;
  card: BrainCard;
  news: number;
  lockedPlan?: string;
  index: number;
  onOpen: () => void;
}) {
  const meta = BRAIN_META[brain];
  const line = lockedPlan ? `${lockedPlan} plan` : card.headline;
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: EASE }}
      whileHover={{ y: -3 }}
      aria-label={`${meta.label}: ${line}${news ? `, ${news} new` : ""}`}
      className={cn(
        "ds-tile group relative grid h-full grid-rows-[40px_auto_1fr] gap-3 overflow-hidden p-4 text-left",
        dsFocus,
      )}
    >
      {/* The brain's colour, as a soft wash that brightens on hover. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-[0.12] blur-2xl transition-opacity duration-500 group-hover:opacity-30"
        style={{ background: meta.color }}
      />
      <span className="relative flex items-center justify-between">
        <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[var(--ds-well-bg)]">
          <BrainMark
            brain={brain}
            size={22}
            active={news > 0}
            muted={!card.ready}
            delay={index * 0.08}
          />
        </span>
        <HealthRing value={card.health} color={meta.color} locked={!!lockedPlan} />
      </span>
      <span className="relative flex h-5 items-center gap-2">
        <span className="text-[15px] font-semibold leading-none tracking-tight">{meta.label}</span>
        <Badge count={news} />
      </span>
      <span className="relative flex flex-col justify-between gap-3">
        <span className="line-clamp-1 text-[12.5px] leading-5 text-muted-foreground">{line}</span>
        <span className="flex h-[22px] flex-wrap gap-1.5 overflow-hidden">
          {(lockedPlan ? [] : card.facts).map((fact) => (
            <span
              key={fact}
              className="ds-well rounded-full px-2 text-[11px] leading-[22px] text-foreground/75"
            >
              {fact}
            </span>
          ))}
        </span>
      </span>
    </motion.button>
  );
}

/**
 * One stem down from each brain, a rail joining them, and a drop into the
 * strategy. Plain boxes on the same grid as the cards, so every line sits
 * exactly under a card's centre.
 */
function Flow({ lit, columns }: { lit: boolean[]; columns: string }) {
  return (
    <div className="relative hidden h-9 sm:block" aria-hidden>
      <div className={cn("grid h-4 gap-3", columns)}>
        {lit.map((on, i) => (
          <span key={i} className="flex justify-center">
            <motion.span
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ duration: 0.3, delay: 0.25 + i * 0.06, ease: EASE }}
              className="h-full w-px origin-top"
              style={{ background: on ? BRAIN_META[BRAINS[i]].color : "var(--ds-tile-border)" }}
            />
          </span>
        ))}
      </div>
      {/* The rail runs between the first and last card centres. */}
      <div className={cn("grid gap-3", columns)}>
        <motion.span
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.45, delay: 0.45, ease: EASE }}
          className="col-span-full h-px bg-[var(--ds-tile-border)]"
          style={{
            marginInline: `calc((100% - ${(lit.length - 1) * 0.75}rem) / ${lit.length * 2})`,
          }}
        />
      </div>
      <motion.span
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 0.3, delay: 0.7, ease: EASE }}
        className="absolute bottom-0 left-1/2 top-4 w-px origin-top -translate-x-1/2 bg-primary/60"
      />
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.3, delay: 0.9, ease: EASE }}
        className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-primary"
      />
    </div>
  );
}

const tint = (i: number) => `hsl(var(--primary) / ${Math.max(0.3, 1 - i * 0.18)})`;

function StrategyBar({
  strategy,
  news,
  onOpen,
}: {
  strategy: BrainOverview["strategy"];
  news: number;
  onOpen: () => void;
}) {
  const has = !!strategy.status;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.3, ease: EASE }}
      className="ds-tile p-4 ring-1 ring-primary/20 sm:p-5"
    >
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-primary/12">
          <BrainIcon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex h-5 items-center gap-2">
            <h3 className="text-[15px] font-semibold leading-none tracking-tight">Strategy</h3>
            {strategy.status === "confirmed" && (
              <span className="inline-flex h-5 items-center gap-1 rounded-full bg-primary/15 px-2 text-[11px] font-medium leading-none">
                <Check className="h-3 w-3 text-primary" /> In use
              </span>
            )}
            {strategy.status === "draft" && (
              <span className="inline-flex h-5 items-center rounded-full bg-warning/15 px-2 text-[11px] font-medium leading-none text-warning">
                Draft
              </span>
            )}
            <Badge count={news} />
          </div>
          <p className="mt-1.5 line-clamp-1 text-[12.5px] leading-5 text-muted-foreground">
            {has ? strategy.headline : "One plan from all four brains."}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className={cn(has ? dsGhostBtn : dsPrimaryBtn, "h-9 shrink-0 px-4 text-[13px]")}
        >
          {has ? (strategy.status === "draft" ? "Review" : "Open") : "Create"}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {strategy.pillars.length > 0 && (
        <div className="mt-4">
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
            {strategy.pillars.map((p, i) => (
              <motion.span
                key={p.title}
                className="h-full rounded-full"
                style={{ background: tint(i) }}
                initial={{ width: 0 }}
                animate={{ width: `${p.share}%` }}
                transition={{ duration: 0.7, delay: 0.45 + i * 0.08, ease: EASE }}
                title={`${p.title} ${p.share}%`}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {strategy.pillars.map((p, i) => (
              <span
                key={p.title}
                className="inline-flex items-center gap-1.5 text-[12px] leading-5 text-muted-foreground"
              >
                <span className="h-2 w-2 rounded-full" style={{ background: tint(i) }} />
                {p.title}
                <span className="tabular-nums text-foreground/70">{p.share}%</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

export function UpdateRow({
  update,
  fresh,
  onOpen,
  index = 0,
}: {
  update: BrainUpdate;
  fresh?: boolean;
  onOpen: () => void;
  index?: number;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, delay: Math.min(index, 8) * 0.035, ease: EASE }}
      className="grid grid-cols-[minmax(0,1fr)_28px] items-center"
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "grid min-h-11 grid-cols-[28px_minmax(0,1fr)_32px] items-center gap-2 rounded-[14px] px-2 py-1.5 text-left transition-colors hover:bg-[var(--ds-well-bg)]",
          dsFocus,
        )}
      >
        <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-[var(--ds-well-bg)]">
          {update.brain === "strategy" ? (
            <BrainIcon size={16} />
          ) : (
            <BrainMark brain={update.brain} size={15} active={fresh} />
          )}
        </span>
        <span className="min-w-0">
          <span
            className={cn(
              "block truncate text-[13px] leading-5",
              fresh ? "font-semibold" : "font-medium",
            )}
          >
            {update.title}
          </span>
          {update.detail && (
            <span className="block truncate text-[12px] leading-4 text-muted-foreground">
              {update.detail}
            </span>
          )}
        </span>
        <span className="text-right text-[11px] tabular-nums text-muted-foreground">
          {ago(update.at)}
        </span>
      </button>
      {update.url ? (
        <a
          href={update.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label="Open the source"
          title="Source"
          className={cn(
            "grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-[var(--ds-well-bg)] hover:text-foreground",
            dsFocus,
          )}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      ) : (
        <span aria-hidden />
      )}
    </motion.li>
  );
}

function ColumnTitle({ children, count }: { children: string; count?: number }) {
  return (
    <div className="mb-2 flex h-6 items-center gap-2 px-2">
      <h3 className="ds-label">{children}</h3>
      {!!count && <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>}
    </div>
  );
}

export function BrainHome({ overview, news, locked = {}, onOpen }: BrainHomeProps) {
  const shown = BRAINS.filter((b) => overview.brains[b].enabled);
  const columns = shown.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3";
  return (
    <div className="mx-auto w-full max-w-[1040px] px-4 pb-10 pt-5 sm:px-6">
      <div className={cn("grid auto-rows-fr gap-3", columns)}>
        {shown.map((brain, i) => (
          <BrainTile
            key={brain}
            brain={brain}
            card={overview.brains[brain]}
            news={news[brain]}
            lockedPlan={locked[brain]}
            index={i}
            onOpen={() => onOpen(brain)}
          />
        ))}
      </div>

      <Flow
        lit={shown.map((b) => overview.brains[b].ready)}
        columns={columns.replace("grid-cols-2 ", "")}
      />
      <div className="h-3 sm:hidden" />

      <StrategyBar
        strategy={overview.strategy}
        news={news.strategy}
        onOpen={() => onOpen("strategy")}
      />

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div role="region" aria-label="What's new">
          <ColumnTitle count={overview.updates.length}>What's new</ColumnTitle>
          {overview.updates.length ? (
            <ul className="space-y-0.5">
              {overview.updates.slice(0, 8).map((update, i) => (
                <UpdateRow
                  key={update.id}
                  update={update}
                  index={i}
                  onOpen={() => onOpen(update.brain)}
                />
              ))}
            </ul>
          ) : (
            <p className="ds-well mx-2 rounded-[16px] px-4 py-6 text-center text-[13px] text-muted-foreground">
              Nothing new yet.
            </p>
          )}
        </div>

        <div role="region" aria-label="Next">
          <ColumnTitle count={overview.needs.length}>Next</ColumnTitle>
          {overview.needs.length ? (
            <ul className="space-y-2">
              {overview.needs.map((need, i) => (
                <motion.li
                  key={need.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.2 + i * 0.05, ease: EASE }}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(need.brain)}
                    className={cn(
                      "ds-tile ds-tile-hover grid min-h-[52px] w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2 text-left",
                      dsFocus,
                    )}
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-[var(--ds-well-bg)]">
                      {need.brain === "strategy" ? (
                        <BrainIcon size={16} />
                      ) : (
                        <BrainMark brain={need.brain} size={15} />
                      )}
                    </span>
                    <span className="min-w-0 text-[13px] font-medium leading-snug">
                      {need.label}
                    </span>
                    <span className="rounded-full bg-primary/12 px-2.5 text-[12px] font-semibold leading-6 text-foreground">
                      {need.cta}
                    </span>
                  </button>
                </motion.li>
              ))}
            </ul>
          ) : (
            <div className="ds-tile grid min-h-[52px] grid-cols-[28px_minmax(0,1fr)] items-center gap-2.5 px-3 py-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-primary">
                <Check className="h-4 w-4" />
              </span>
              <span className="text-[13px] font-medium">All set</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
