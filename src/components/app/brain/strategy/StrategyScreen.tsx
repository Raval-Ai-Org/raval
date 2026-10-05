"use client";
// StrategyScreen — the workspace's marketing strategy on one page: mostly
// pictures, few words. Presentational: the view and every action come in as
// props, so /brain-lab can render it with sample data.
//
// A draft waits for a person. Only a confirmed strategy is followed by Studio,
// chat, the Coach and Autopilot.
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  FacebookIcon,
  Globe,
  InstagramIcon,
  LinkedinIcon,
  Mail,
  Pencil,
  PinterestIcon,
  RefreshCw,
  ThreadsIcon,
  TiktokIcon,
  Trash,
  X,
  XIcon,
  YoutubeIcon,
} from "@/components/icons";
import { CostChip } from "@/components/app/CostChip";
import { dsFocus, dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import { BRAINS, BRAIN_META, type BrainId } from "@/lib/brain/brain";
import {
  STAGE_LABELS,
  STRATEGY_STAGES,
  type MarketingStrategy,
  type StrategyView,
} from "@/lib/strategy/contracts";
import { normalizeShares } from "@/lib/strategy/ground";
import { PLAN_GOALS } from "@/lib/calendar/planner";
import { cn } from "@/lib/utils";
import { BrainIcon, BrainMark } from "../BrainMark";

const EASE = [0.16, 1, 0.3, 1] as const;

export type StrategyHandlers = {
  /** Write (or rewrite) the strategy from the brains. */
  generate: (note?: string) => void;
  save: (strategy: MarketingStrategy, confirm: boolean) => void;
  /** Go fill a brain that has nothing in it yet. */
  openBrain: (brain: BrainId) => void;
  generating: boolean;
  saving: boolean;
};

const PLATFORM_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  linkedin: LinkedinIcon,
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  x: XIcon,
  twitter: XIcon,
  tiktok: TiktokIcon,
  youtube: YoutubeIcon,
  threads: ThreadsIcon,
  pinterest: PinterestIcon,
  email: Mail,
  website: Globe,
};

const tint = (i: number) => `hsl(var(--primary) / ${Math.max(0.28, 1 - i * 0.17)})`;

/* ───────────────────────── small pieces ───────────────────────── */

function Block({
  title,
  children,
  className,
  mark,
  index = 0,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  mark?: BrainId;
  index?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 + index * 0.05, ease: EASE }}
      className={cn("ds-tile p-4 sm:p-5", className)}
    >
      <header className="mb-3 flex items-center gap-2">
        {mark && <BrainMark brain={mark} size={16} />}
        <h4 className="ds-label">{title}</h4>
      </header>
      {children}
    </motion.section>
  );
}

/** Text that turns into a field while editing. */
function T({
  value,
  onChange,
  editing,
  multiline,
  className,
  placeholder,
  max = 300,
}: {
  value: string;
  onChange: (v: string) => void;
  editing: boolean;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
  max?: number;
}) {
  if (!editing) return <span className={className}>{value}</span>;
  const cls = cn(
    "ds-well w-full rounded-[12px] px-3 py-2 text-[13px] text-foreground outline-none ring-1 ring-transparent focus:ring-primary/40",
    className && "font-[inherit]",
  );
  return multiline ? (
    <textarea
      value={value}
      maxLength={max}
      rows={2}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(cls, "resize-y leading-snug")}
    />
  ) : (
    <input
      value={value}
      maxLength={max}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cls}
    />
  );
}

function RemoveBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title="Remove" className={dsIconBtn}>
      <Trash className="h-3.5 w-3.5" />
    </button>
  );
}

/** Theme mix as a ring: each arc draws itself in. */
function MixRing({ pillars }: { pillars: MarketingStrategy["pillars"] }) {
  const size = 132;
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="-rotate-90 shrink-0"
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--ds-well-bg)"
        strokeWidth={16}
      />
      {pillars.map((p, i) => {
        const len = (p.share / 100) * c;
        const dash = Math.max(0, len - 3);
        const start = offset;
        offset += len;
        return (
          <motion.circle
            key={`${p.title}-${i}`}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={tint(i)}
            strokeWidth={16}
            strokeDashoffset={-start}
            initial={{ strokeDasharray: `0 ${c}` }}
            animate={{ strokeDasharray: `${dash} ${c - dash}` }}
            transition={{ duration: 0.7, delay: 0.2 + i * 0.1, ease: EASE }}
          />
        );
      })}
    </svg>
  );
}

/** Seven dots for a week; `count` of them lit. */
function WeekDots({ count }: { count: number }) {
  const lit = Math.min(7, count);
  return (
    <span className="flex items-center gap-1" aria-label={`${count} a week`}>
      {Array.from({ length: 7 }).map((_, i) => (
        <motion.span
          key={i}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.25, delay: 0.25 + i * 0.04, ease: EASE }}
          className={cn(
            "h-2 w-2 rounded-full",
            i < lit ? "bg-primary" : "bg-[var(--ds-well-bg-hover)]",
          )}
        />
      ))}
      {count > 7 && (
        <span className="text-[11px] tabular-nums text-muted-foreground">+{count - 7}</span>
      )}
    </span>
  );
}

/* ───────────────────────── empty and writing states ───────────────────────── */

function BrainsRow({
  available,
  onOpen,
  pulsing,
}: {
  available: StrategyView["available"];
  onOpen?: (brain: BrainId) => void;
  pulsing?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-stretch justify-center gap-2.5">
      {BRAINS.map((brain, i) => {
        const on = available[brain];
        const body = (
          <>
            <BrainMark brain={brain} size={30} muted={!on} active={pulsing && on} delay={i * 0.1} />
            <span className="mt-2 text-[12.5px] font-medium">{BRAIN_META[brain].label}</span>
            <span className={cn("text-[11px]", on ? "text-primary" : "text-muted-foreground")}>
              {on ? "Ready" : "Empty"}
            </span>
          </>
        );
        const cls = "ds-tile flex w-[104px] flex-col items-center px-3 py-3 text-center";
        return on || !onOpen ? (
          <div key={brain} className={cls}>
            {body}
          </div>
        ) : (
          <button
            key={brain}
            type="button"
            onClick={() => onOpen(brain)}
            className={cn(cls, "ds-tile-hover", dsFocus)}
            aria-label={`${BRAIN_META[brain].label} is empty. Open it.`}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

function Writing({ available }: { available: StrategyView["available"] }) {
  const reduce = useReducedMotionSafe();
  return (
    <div
      className="mx-auto flex max-w-[560px] flex-col items-center px-4 py-14 text-center"
      role="status"
    >
      <BrainsRow available={available} pulsing />
      <svg
        viewBox="0 0 100 20"
        className="my-3 h-10 w-[70%]"
        preserveAspectRatio="none"
        aria-hidden
      >
        {[12, 37, 63, 88].map((x, i) => (
          <motion.path
            key={x}
            d={`M ${x} 0 C ${x} 12, 50 8, 50 20`}
            fill="none"
            stroke={BRAIN_META[BRAINS[i]].color}
            strokeWidth={1.6}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            strokeDasharray="0.2 1"
            initial={{ strokeDashoffset: 1.2 }}
            animate={reduce ? undefined : { strokeDashoffset: 0 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "linear", delay: i * 0.2 }}
          />
        ))}
      </svg>
      <motion.span
        animate={reduce ? undefined : { scale: [1, 1.08, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        className="grid h-14 w-14 place-items-center rounded-full bg-primary/12 ring-1 ring-primary/30"
      >
        <BrainIcon size={28} />
      </motion.span>
      <p className="mt-4 text-[15px] font-semibold">Writing your strategy…</p>
      <p className="mt-1 text-[13px] text-muted-foreground">About a minute.</p>
    </div>
  );
}

function Empty({ view, handlers }: { view: StrategyView; handlers: StrategyHandlers }) {
  const [note, setNote] = React.useState("");
  const ready = view.available.brand;
  return (
    <div className="mx-auto flex max-w-[600px] flex-col items-center px-4 py-12 text-center">
      <span className="ds-glow grid h-16 w-16 place-items-center rounded-full bg-primary/12 ring-1 ring-primary/30">
        <BrainIcon size={32} />
      </span>
      <h3 className="mt-4 text-[22px] font-semibold tracking-tight">Your marketing strategy</h3>
      <p className="mt-1 text-[13.5px] text-muted-foreground">
        One plan from all four brains. Mellox follows it in everything it makes.
      </p>
      <div className="mt-6">
        <BrainsRow available={view.available} onOpen={handlers.openBrain} />
      </div>
      {view.canEdit && (
        <>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Anything to focus on? (optional)"
            className="ds-well mt-6 w-full resize-none rounded-[16px] px-4 py-3 text-[13.5px] outline-none ring-1 ring-transparent focus:ring-primary/40"
          />
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={!ready || handlers.generating}
              onClick={() => handlers.generate(note)}
              className={cn(dsPrimaryBtn, "h-11 px-6 text-[14px]")}
            >
              Create my strategy
            </button>
            {view.nextIsFree ? <CostChip free /> : <CostChip action="strategy_rebuild" />}
          </div>
          {!ready && (
            <button
              type="button"
              onClick={() => handlers.openBrain("brand")}
              className="mt-3 text-[12.5px] font-medium text-foreground underline underline-offset-4"
            >
              Add your Brand DNA first
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────── the strategy ───────────────────────── */

export function StrategyScreen({
  view,
  handlers,
}: {
  view: StrategyView;
  handlers: StrategyHandlers;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<MarketingStrategy | null>(view.strategy);
  const [rebuild, setRebuild] = React.useState(false);

  // A new version from the server replaces the local copy (and ends editing).
  React.useEffect(() => {
    setDraft(view.strategy);
    setEditing(false);
    setRebuild(false);
  }, [view.strategy, view.version]);

  if (handlers.generating) return <Writing available={view.available} />;
  if (!view.strategy || !draft) return <Empty view={view} handlers={handlers} />;

  const s = draft;
  const set = (patch: Partial<MarketingStrategy>) => setDraft({ ...s, ...patch });
  const goalLabel = PLAN_GOALS.find((g) => g.id === s.goal.type)?.label ?? s.goal.type;
  const isDraft = view.status === "draft";

  const setPillar = (i: number, patch: Partial<MarketingStrategy["pillars"][number]>) =>
    set({ pillars: s.pillars.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const dropPillar = (i: number) => {
    const rest = s.pillars.filter((_, j) => j !== i);
    const shares = normalizeShares(rest.map((p) => p.share));
    set({ pillars: rest.map((p, j) => ({ ...p, share: shares[j] })) });
  };
  const finish = (confirm: boolean) => {
    const shares = normalizeShares(s.pillars.map((p) => p.share));
    handlers.save(
      { ...s, pillars: s.pillars.map((p, i) => ({ ...p, share: shares[i] })) },
      confirm,
    );
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pb-12 pt-5 sm:px-7 sm:pt-6">
      {/* ── status and actions ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {isDraft ? (
          <span className="rounded-full bg-warning/15 px-2.5 py-1 text-[12px] font-medium text-warning">
            Draft — not in use yet
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-[12px] font-medium">
            <Check className="h-3.5 w-3.5 text-primary" /> Mellox follows this
          </span>
        )}
        <span className="flex items-center gap-1.5" title="Built from">
          {BRAINS.map((b) => (
            <BrainMark key={b} brain={b} size={14} muted={!view.builtFrom[b]} />
          ))}
        </span>
        {view.canEdit && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
                  onClick={() => {
                    setDraft(view.strategy);
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={handlers.saving}
                  className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
                  onClick={() => finish(!isDraft)}
                >
                  Save
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
                  onClick={() => setRebuild((v) => !v)}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Rebuild
                </button>
                <button
                  type="button"
                  className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                {isDraft && (
                  <button
                    type="button"
                    disabled={handlers.saving}
                    className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
                    onClick={() => finish(true)}
                  >
                    <Check className="h-4 w-4" /> Use this strategy
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {(view.stale || rebuild) && view.canEdit && !editing && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="ds-well mb-4 flex flex-wrap items-center gap-3 rounded-[16px] px-4 py-3">
              <RefreshCw className="h-4 w-4 text-primary" />
              <span className="min-w-0 flex-1 text-[13px] font-medium">
                {view.stale
                  ? "Your brains changed since this was written."
                  : "Write it again from your brains?"}
              </span>
              <CostChip action="strategy_rebuild" />
              <button
                type="button"
                className={cn(dsPrimaryBtn, "h-8 px-3.5 text-[12.5px]")}
                onClick={() => handlers.generate()}
              >
                Rebuild
              </button>
              {rebuild && !view.stale && (
                <button
                  type="button"
                  aria-label="Close"
                  className={dsIconBtn}
                  onClick={() => setRebuild(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── positioning ── */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE }}
        className="ds-tile ds-glow relative overflow-hidden p-5 sm:p-7"
      >
        <div className="flex items-center gap-2">
          <BrainMark brain="brand" size={16} />
          <span className="ds-label">Positioning</span>
        </div>
        <div className="mt-3 text-[20px] font-semibold leading-snug tracking-tight sm:text-[24px]">
          <T
            value={s.positioning.statement}
            editing={editing}
            multiline
            max={320}
            onChange={(statement) => set({ positioning: { ...s.positioning, statement } })}
          />
        </div>
        {(s.positioning.promise || editing) && (
          <div className="mt-2 text-[14px] text-muted-foreground">
            <T
              value={s.positioning.promise}
              editing={editing}
              max={200}
              placeholder="The result a customer gets"
              onChange={(promise) => set({ positioning: { ...s.positioning, promise } })}
            />
          </div>
        )}
        {s.positioning.differentiators.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {s.positioning.differentiators.map((d, i) => (
              <span
                key={`${d}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary/12 px-3 py-1 text-[12.5px] font-medium"
              >
                {d}
                {editing && (
                  <button
                    type="button"
                    aria-label={`Remove ${d}`}
                    onClick={() =>
                      set({
                        positioning: {
                          ...s.positioning,
                          differentiators: s.positioning.differentiators.filter((_, j) => j !== i),
                        },
                      })
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </motion.section>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {/* ── goal ── */}
        <Block title="Goal" index={1}>
          <div className="text-[13px] font-medium text-primary">{goalLabel}</div>
          <div className="mt-1 text-[14px] leading-snug">
            <T
              value={s.goal.summary}
              editing={editing}
              multiline
              max={240}
              onChange={(summary) => set({ goal: { ...s.goal, summary } })}
            />
          </div>
          {(s.goal.metric || editing) && (
            <div className="ds-well mt-3 rounded-[14px] p-3">
              <div className="text-[11.5px] text-muted-foreground">
                <T
                  value={s.goal.metric}
                  editing={editing}
                  max={80}
                  placeholder="Number to watch"
                  onChange={(metric) => set({ goal: { ...s.goal, metric } })}
                />
              </div>
              <div className="mt-0.5 text-[22px] font-semibold leading-tight tabular-nums">
                <T
                  value={s.goal.target || (editing ? "" : "—")}
                  editing={editing}
                  max={80}
                  placeholder="Target"
                  onChange={(target) => set({ goal: { ...s.goal, target } })}
                />
              </div>
            </div>
          )}
        </Block>

        {/* ── themes ── */}
        <Block title="What to post about" className="lg:col-span-2" index={2}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <MixRing pillars={s.pillars} />
            <ul className="min-w-0 flex-1 space-y-2.5">
              {s.pillars.map((p, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: tint(i) }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[13.5px] font-semibold">
                      <T
                        value={p.title}
                        editing={editing}
                        max={60}
                        onChange={(title) => setPillar(i, { title })}
                      />
                      {editing ? (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={p.share}
                          aria-label={`${p.title} share of posts`}
                          onChange={(e) => setPillar(i, { share: Number(e.target.value) || 0 })}
                          className="ds-well w-16 rounded-[10px] px-2 py-1.5 text-[12.5px] tabular-nums outline-none"
                        />
                      ) : (
                        <span className="text-[12.5px] font-medium tabular-nums text-muted-foreground">
                          {p.share}%
                        </span>
                      )}
                    </div>
                    {(p.detail || editing) && (
                      <div className="text-[12.5px] leading-snug text-muted-foreground">
                        <T
                          value={p.detail}
                          editing={editing}
                          max={200}
                          onChange={(detail) => setPillar(i, { detail })}
                        />
                      </div>
                    )}
                  </div>
                  {editing && s.pillars.length > 2 && (
                    <RemoveBtn onClick={() => dropPillar(i)} label={`Remove ${p.title}`} />
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Block>
      </div>

      {/* ── who it's for ── */}
      {s.audiences.length > 0 && (
        <Block title="Who it's for" mark="audience" className="mt-4" index={3}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {s.audiences.map((a, i) => (
              <div key={i} className="ds-well rounded-[16px] p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13.5px] font-semibold">{a.name}</span>
                  {editing && (
                    <RemoveBtn
                      onClick={() => set({ audiences: s.audiences.filter((_, j) => j !== i) })}
                      label={`Remove ${a.name}`}
                    />
                  )}
                </div>
                {(a.message || editing) && (
                  <div className="mt-2 text-[13px] italic leading-snug">
                    <T
                      value={editing ? a.message : `“${a.message}”`}
                      editing={editing}
                      multiline
                      max={220}
                      placeholder="The line that should land"
                      onChange={(message) =>
                        set({
                          audiences: s.audiences.map((x, j) => (j === i ? { ...x, message } : x)),
                        })
                      }
                    />
                  </div>
                )}
                {a.why && !editing && (
                  <div className="mt-1.5 text-[12px] text-muted-foreground">{a.why}</div>
                )}
              </div>
            ))}
          </div>
        </Block>
      )}

      {/* ── where and how often ── */}
      {s.channels.length > 0 && (
        <Block title="Where and how often" className="mt-4" index={4}>
          <ul className="divide-y divide-border/50">
            {s.channels.map((c, i) => {
              const Icon = PLATFORM_ICON[c.platform] ?? Globe;
              return (
                <li
                  key={i}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <span className="flex w-[128px] shrink-0 items-center gap-2 text-[13.5px] font-semibold capitalize">
                    <Icon className="h-4 w-4" /> {c.platform}
                  </span>
                  <WeekDots count={c.perWeek} />
                  {editing ? (
                    <input
                      type="number"
                      min={0}
                      max={21}
                      value={c.perWeek}
                      aria-label={`${c.platform} posts a week`}
                      onChange={(e) =>
                        set({
                          channels: s.channels.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  perWeek: Math.max(0, Math.min(21, Number(e.target.value) || 0)),
                                }
                              : x,
                          ),
                        })
                      }
                      className="ds-well w-16 rounded-[10px] px-2 py-1.5 text-[12.5px] tabular-nums outline-none"
                    />
                  ) : (
                    <span className="text-[12.5px] tabular-nums text-muted-foreground">
                      {c.perWeek} a week
                    </span>
                  )}
                  <span className="min-w-[160px] flex-1 text-[12.5px] text-muted-foreground">
                    {c.role}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {c.formats.map((f) => (
                      <span
                        key={f}
                        className="ds-well rounded-full px-2 py-0.5 text-[11px] capitalize"
                      >
                        {f}
                      </span>
                    ))}
                  </span>
                  {editing && (
                    <RemoveBtn
                      onClick={() => set({ channels: s.channels.filter((_, j) => j !== i) })}
                      label={`Remove ${c.platform}`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Block>
      )}

      {/* ── what to say, step by step ── */}
      <Block title="What to say" className="mt-4" index={5}>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STRATEGY_STAGES.map((stage, i) => (
            <li key={stage} className="relative">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11.5px] font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <span className="text-[13px] font-semibold">{STAGE_LABELS[stage]}</span>
                {i < 3 && (
                  <ChevronRight className="ml-auto hidden h-4 w-4 text-muted-foreground/60 lg:block" />
                )}
              </div>
              <div className="mt-2 text-[13px] leading-snug text-muted-foreground">
                <T
                  value={s.messages[stage] || (editing ? "" : "—")}
                  editing={editing}
                  multiline
                  max={240}
                  onChange={(text) => set({ messages: { ...s.messages, [stage]: text } })}
                />
              </div>
            </li>
          ))}
        </ol>
      </Block>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* ── how to win ── */}
        {s.competitors.length > 0 && (
          <Block title="How you win" mark="competitors" index={6}>
            <ul className="space-y-3">
              {s.competitors.map((c, i) => (
                <li key={c.competitorId} className="ds-well rounded-[16px] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold">vs {c.name}</span>
                    {editing && (
                      <RemoveBtn
                        onClick={() =>
                          set({ competitors: s.competitors.filter((_, j) => j !== i) })
                        }
                        label={`Remove ${c.name}`}
                      />
                    )}
                  </div>
                  {c.theirAngle && !editing && (
                    <div className="mt-1 text-[12px] text-muted-foreground">
                      They say: {c.theirAngle}
                    </div>
                  )}
                  <div className="mt-1.5 text-[13px] font-medium leading-snug">
                    <T
                      value={c.ourEdge}
                      editing={editing}
                      multiline
                      max={260}
                      onChange={(ourEdge) =>
                        set({
                          competitors: s.competitors.map((x, j) =>
                            j === i ? { ...x, ourEdge } : x,
                          ),
                        })
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Block>
        )}

        {/* ── what the market invites ── */}
        {s.plays.length > 0 && (
          <Block title="Moves to make now" mark="market" index={7}>
            <ul className="space-y-3">
              {s.plays.map((p, i) => (
                <li key={p.sourceUrl} className="ds-well rounded-[16px] p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-semibold leading-snug">{p.title}</span>
                    {editing ? (
                      <RemoveBtn
                        onClick={() => set({ plays: s.plays.filter((_, j) => j !== i) })}
                        label={`Remove ${p.title}`}
                      />
                    ) : (
                      <a
                        href={p.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        title={p.sourceTitle || "Source"}
                        aria-label={`Source: ${p.sourceTitle || p.sourceUrl}`}
                        className={dsIconBtn}
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  {p.detail && (
                    <div className="mt-1 text-[12.5px] text-muted-foreground">{p.detail}</div>
                  )}
                </li>
              ))}
            </ul>
          </Block>
        )}
      </div>

      {/* ── 90 days ── */}
      {s.roadmap.length > 0 && (
        <Block title="Next 90 days" className="mt-4" index={8}>
          <ol className="relative grid gap-4 sm:grid-cols-3">
            <span
              aria-hidden
              className="absolute left-0 right-0 top-[11px] hidden h-px bg-[var(--ds-tile-border)] sm:block"
            />
            {s.roadmap.map((phase, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.3 + i * 0.1, ease: EASE }}
                className="relative"
              >
                <span className="relative z-10 inline-flex items-center gap-2 bg-[var(--ds-tile-bg)] pr-2">
                  <span className="h-[22px] w-[22px] rounded-full bg-primary ring-4 ring-primary/15" />
                  <span className="text-[12px] font-semibold text-muted-foreground">
                    {phase.phase}
                  </span>
                </span>
                <div className="mt-2 text-[14px] font-semibold leading-snug">
                  <T
                    value={phase.focus}
                    editing={editing}
                    max={140}
                    onChange={(focus) =>
                      set({ roadmap: s.roadmap.map((x, j) => (j === i ? { ...x, focus } : x)) })
                    }
                  />
                </div>
                <ul className="mt-2 space-y-1.5">
                  {phase.actions.map((a, k) => (
                    <li
                      key={k}
                      className="flex items-start gap-2 text-[12.5px] text-muted-foreground"
                    >
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {a}
                    </li>
                  ))}
                </ul>
              </motion.li>
            ))}
          </ol>
        </Block>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* ── numbers ── */}
        {s.kpis.length > 0 && (
          <Block title="Numbers to watch" index={9}>
            <div className="grid grid-cols-2 gap-3">
              {s.kpis.map((k, i) => (
                <div key={i} className="ds-well rounded-[14px] p-3">
                  <div className="flex items-start justify-between gap-1">
                    <div className="text-[11.5px] text-muted-foreground">{k.label}</div>
                    {editing && (
                      <RemoveBtn
                        onClick={() => set({ kpis: s.kpis.filter((_, j) => j !== i) })}
                        label={`Remove ${k.label}`}
                      />
                    )}
                  </div>
                  <div className="mt-0.5 text-[18px] font-semibold leading-tight tabular-nums">
                    <T
                      value={k.target || (editing ? "" : "—")}
                      editing={editing}
                      max={60}
                      placeholder="Target"
                      onChange={(target) =>
                        set({ kpis: s.kpis.map((x, j) => (j === i ? { ...x, target } : x)) })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </Block>
        )}

        {/* ── rules ── */}
        {(s.rules.do.length > 0 || s.rules.dont.length > 0) && (
          <Block title="Always and never" index={10}>
            <div className="grid gap-4 sm:grid-cols-2">
              {(["do", "dont"] as const).map((kind) => (
                <ul key={kind} className="space-y-2">
                  {s.rules[kind].map((rule, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
                      <span
                        className={cn(
                          "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full",
                          kind === "do"
                            ? "bg-primary/20 text-primary"
                            : "bg-destructive/15 text-destructive",
                        )}
                      >
                        {kind === "do" ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">{rule}</span>
                      {editing && (
                        <RemoveBtn
                          onClick={() =>
                            set({
                              rules: {
                                ...s.rules,
                                [kind]: s.rules[kind].filter((_, j) => j !== i),
                              },
                            })
                          }
                          label="Remove rule"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </Block>
        )}
      </div>
    </div>
  );
}
