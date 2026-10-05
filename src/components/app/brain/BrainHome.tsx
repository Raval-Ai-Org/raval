"use client";
// BrainHome — the four brains feeding one strategy, at a glance.
// Presentational: everything it shows comes in as props (BrainOverview), so
// /brain-lab can render it with sample data.
import { motion } from "framer-motion";
import { ArrowUpRight, Check, ChevronRight, Lock } from "@/components/icons";
import { dsFocus, dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
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

/** A ring that fills to `value` percent. */
function HealthRing({ value, color, size = 44 }: { value: number; color: string; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="-rotate-90"
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--ds-well-bg-hover)"
        strokeWidth={4}
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(100, value)) / 100) }}
        transition={{ duration: 0.9, ease: EASE, delay: 0.15 }}
      />
    </svg>
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
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06, ease: EASE }}
      whileHover={{ y: -3 }}
      aria-label={`${meta.label}: ${card.headline}${news ? `, ${news} new` : ""}`}
      className={cn(
        "ds-tile group relative flex min-h-[152px] flex-col overflow-hidden p-4 text-left",
        dsFocus,
      )}
    >
      {/* The brain's colour, as a soft wash that brightens on hover. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-[0.14] blur-2xl transition-opacity duration-500 group-hover:opacity-30"
        style={{ background: meta.color }}
      />
      <div className="flex items-start justify-between gap-2">
        <BrainMark
          brain={brain}
          size={34}
          active={news > 0}
          muted={!card.ready}
          delay={index * 0.08}
        />
        <div className="relative grid place-items-center">
          <HealthRing value={card.health} color={meta.color} />
          <span className="absolute text-[11px] font-semibold tabular-nums text-foreground/80">
            {lockedPlan ? <Lock className="h-3.5 w-3.5" /> : card.health}
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[15px] font-semibold tracking-tight">{meta.label}</span>
        {news > 0 && (
          <span className="rounded-full bg-primary px-1.5 text-[10.5px] font-semibold leading-[18px] text-primary-foreground">
            {news}
          </span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">
        {lockedPlan ? `On the ${lockedPlan} plan` : card.headline}
      </p>
      {card.facts.length > 0 && !lockedPlan && (
        <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
          {card.facts.map((fact) => (
            <span
              key={fact}
              className="ds-well rounded-full px-2 py-0.5 text-[11px] text-foreground/75"
            >
              {fact}
            </span>
          ))}
        </div>
      )}
    </motion.button>
  );
}

/** Four lines running from the brains down into the strategy, with light moving along them. */
function Flow({ lit }: { lit: boolean[] }) {
  const reduce = useReducedMotionSafe();
  const xs = [12.5, 37.5, 62.5, 87.5];
  return (
    <svg
      viewBox="0 0 100 14"
      preserveAspectRatio="none"
      className="hidden h-10 w-full sm:block"
      aria-hidden
    >
      {xs.map((x, i) => {
        const d = `M ${x} 0 C ${x} 9, 50 5, 50 14`;
        const color = BRAIN_META[BRAINS[i]].color;
        return (
          <g key={x}>
            <path
              d={d}
              fill="none"
              stroke="var(--ds-tile-border)"
              strokeWidth={0.35}
              vectorEffect="non-scaling-stroke"
            />
            {lit[i] && !reduce && (
              <motion.path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={1.6}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                pathLength={1}
                strokeDasharray="0.14 1"
                initial={{ strokeDashoffset: 1.14 }}
                animate={{ strokeDashoffset: 0 }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "linear", delay: i * 0.45 }}
              />
            )}
            {lit[i] && reduce && (
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={1}
                opacity={0.5}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

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
      className="ds-tile ds-glow relative overflow-hidden p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/12 ring-1 ring-primary/25">
          <BrainIcon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold tracking-tight">Strategy</h3>
            {strategy.status === "confirmed" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-foreground">
                <Check className="h-3 w-3 text-primary" /> Mellox follows this
              </span>
            )}
            {strategy.status === "draft" && (
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                Waiting for you
              </span>
            )}
            {news > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10.5px] font-semibold leading-[18px] text-primary-foreground">
                {news}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] text-muted-foreground">
            {has ? strategy.headline : "One plan, written from all four brains."}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className={cn(has ? dsGhostBtn : dsPrimaryBtn, "h-9 px-4 text-[13px]")}
        >
          {has ? (strategy.status === "draft" ? "Review" : "Open") : "Create"}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      {strategy.pillars.length > 0 && (
        <div className="mt-4">
          <div className="flex h-2 overflow-hidden rounded-full bg-[var(--ds-well-bg)]">
            {strategy.pillars.map((p, i) => (
              <motion.span
                key={p.title}
                className="h-full"
                style={{ background: `hsl(var(--primary) / ${1 - i * 0.17})` }}
                initial={{ width: 0 }}
                animate={{ width: `${p.share}%` }}
                transition={{ duration: 0.7, delay: 0.45 + i * 0.08, ease: EASE }}
                title={`${p.title} ${p.share}%`}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {strategy.pillars.map((p, i) => (
              <span
                key={p.title}
                className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: `hsl(var(--primary) / ${1 - i * 0.17})` }}
                />
                {p.title} <span className="tabular-nums text-foreground/70">{p.share}%</span>
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
      className="group flex items-start gap-1"
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex min-w-0 flex-1 items-start gap-3 rounded-[14px] px-2.5 py-2 text-left transition-colors hover:bg-[var(--ds-well-bg)]",
          dsFocus,
        )}
      >
        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center">
          {update.brain === "strategy" ? (
            <BrainIcon size={18} />
          ) : (
            <BrainMark brain={update.brain} size={18} active={fresh} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[13px] leading-snug",
              fresh ? "font-semibold" : "font-medium",
            )}
          >
            {update.title}
          </span>
          {update.detail && (
            <span className="mt-0.5 line-clamp-1 block text-[12px] text-muted-foreground">
              {update.detail}
            </span>
          )}
        </span>
        <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">
          {ago(update.at)}
        </span>
      </button>
      {update.url && (
        <a
          href={update.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label="Open the source"
          title="Source"
          className={cn(
            "mt-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-[var(--ds-well-bg)] hover:text-foreground",
            dsFocus,
          )}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      )}
    </motion.li>
  );
}

export function BrainHome({ overview, news, locked = {}, onOpen }: BrainHomeProps) {
  const shown = BRAINS.filter((b) => overview.brains[b].enabled);
  const lit = BRAINS.map((b) => overview.brains[b].enabled && overview.brains[b].ready);
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pb-10 pt-5 sm:px-7 sm:pt-6">
      <div
        className={cn(
          "grid grid-cols-2 gap-3",
          shown.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3",
        )}
      >
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

      {shown.length === 4 ? <Flow lit={lit} /> : <div className="h-3" />}

      <StrategyBar
        strategy={overview.strategy}
        news={news.strategy}
        onOpen={() => onOpen("strategy")}
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="What's new">
          <h3 className="ds-label mb-2">What's new</h3>
          {overview.updates.length ? (
            <ul className="space-y-0.5">
              {overview.updates.slice(0, 12).map((update, i) => (
                <UpdateRow
                  key={update.id}
                  update={update}
                  index={i}
                  onOpen={() => onOpen(update.brain)}
                />
              ))}
            </ul>
          ) : (
            <p className="ds-well rounded-[16px] px-4 py-6 text-center text-[13px] text-muted-foreground">
              Nothing yet. Updates show up here as your brains fill in.
            </p>
          )}
        </section>

        <section aria-label="Next">
          <h3 className="ds-label mb-2">Next</h3>
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
                      "ds-tile ds-tile-hover flex w-full items-center gap-3 p-3 text-left",
                      dsFocus,
                    )}
                  >
                    {need.brain === "strategy" ? (
                      <BrainIcon size={20} />
                    ) : (
                      <BrainMark brain={need.brain} size={20} />
                    )}
                    <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug">
                      {need.label}
                    </span>
                    <span className="shrink-0 rounded-full bg-primary/12 px-2.5 py-1 text-[12px] font-semibold text-foreground">
                      {need.cta}
                    </span>
                  </button>
                </motion.li>
              ))}
            </ul>
          ) : (
            <div className="ds-tile flex items-center gap-3 p-4">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-primary">
                <Check className="h-4 w-4" />
              </span>
              <span className="text-[13px] font-medium">Everything is set.</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
