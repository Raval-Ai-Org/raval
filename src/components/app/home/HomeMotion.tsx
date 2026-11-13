"use client";

// Home's moving pictures (Mellox 2.0, ADR-0044), like Autopilot's flow rail:
// each section shows how its part of Mellox works at a glance.
//   MakeFlow      idea → Mox writes → Mox designs → you approve → posted
//   BrainFlow     the four brains feed Mox, Mox feeds every piece
//   CreatorPhone  a creator Reel playing, hook text sliding in
//   NeedsAndNews  what is left to finish and what the brains found lately
// Pictures are decoration and never show a number; the lists come from the
// free Brain overview only. CSS keyframes live in styles.css (`home-*`), off
// for reduced motion.

import type { ComponentType, CSSProperties } from "react";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Lightbulb,
  Palette,
  Pencil,
  Play,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Video,
  Compass,
} from "@/components/icons";
import type { BrainTileId, HomeNeed, HomeUpdate } from "@/lib/home/explore";
import { cn } from "@/lib/utils";

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;
const vars = (v: Record<string, string>) => v as CSSProperties;

/* ── Make: how a piece is made ───────────────────────────────────────── */

const MAKE_STEPS: { label: string; icon: Icon }[] = [
  { label: "Your idea", icon: Lightbulb },
  { label: "Mox writes", icon: Pencil },
  { label: "Mox designs", icon: Palette },
  { label: "You approve", icon: CheckCircle2 },
  { label: "Posted", icon: Send },
];

export function MakeFlow({ className }: { className?: string }) {
  return (
    <div
      className={cn("ds-card relative overflow-hidden px-4 py-3.5", className)}
      aria-label="How a piece is made: your idea, Mox writes, Mox designs, you approve, posted"
      role="img"
    >
      <div aria-hidden className="relative">
        <div className="absolute left-[10%] right-[10%] top-[17px] h-[3px] overflow-hidden rounded-full bg-foreground/[0.07]">
          <span className="home-beam absolute inset-y-0 left-0 w-1/5 rounded-full [background:var(--mox-gradient)]" />
        </div>
        <ol className="relative grid grid-cols-5">
          {MAKE_STEPS.map((s, i) => (
            <li key={s.label} className="flex min-w-0 flex-col items-center">
              <span
                className="home-node grid size-9 place-items-center rounded-full bg-[var(--ds-card-bg)] text-foreground/75 ring-1 ring-[var(--ds-card-border)]"
                style={vars({ "--d": `${0.35 + i * 0.68}s` })}
              >
                <s.icon className="size-4" strokeWidth={2.1} />
              </span>
              <span className="mt-1.5 block w-full truncate text-center text-[10.5px] font-semibold text-muted-foreground">
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ── Brain: four brains → Mox → every piece ──────────────────────────── */

const BRAIN_IN: { id: BrainTileId; label: string; icon: Icon }[] = [
  { id: "brand", label: "Brand DNA", icon: Sparkles },
  { id: "audience", label: "Audience", icon: Users },
  { id: "competitors", label: "Competitors", icon: Target },
  { id: "market", label: "Market", icon: TrendingUp },
];

const BRAIN_OUT: { label: string; icon: Icon }[] = [
  { label: "Posts", icon: ImageIcon },
  { label: "Videos", icon: Video },
  { label: "Articles", icon: FileText },
];

function Wires({ from, to, flip }: { from: number[]; to: number[]; flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 100 160"
      preserveAspectRatio="none"
      aria-hidden
      className="!h-[160px] min-w-[40px] flex-1"
      style={{ height: 160 }}
    >
      {from.flatMap((y1) =>
        to.map((y2) => {
          const [a, b] = flip ? [y2, y1] : [y1, y2];
          return (
            <g key={`${y1}-${y2}`}>
              <path
                d={`M0 ${a} C 55 ${a}, 45 ${b}, 100 ${b}`}
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.09}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
              <path
                className="home-dash"
                d={`M0 ${a} C 55 ${a}, 45 ${b}, 100 ${b}`}
                fill="none"
                stroke="#3fe46e"
                strokeOpacity={0.75}
                strokeWidth={2}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        }),
      )}
    </svg>
  );
}

function Chip({ label, icon: I, dim }: { label: string; icon: Icon; dim?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] px-2.5 text-[11.5px] font-semibold shadow-[var(--ds-card-shadow)]",
        dim && "opacity-60",
      )}
    >
      <I className="size-3.5" />
      {label}
    </span>
  );
}

/** Only on a wide canvas: on a phone the tiles say the same in words. */
export function BrainFlow({
  enabled,
  className,
}: {
  /** Brains switched on; others are drawn faded. */
  enabled?: ReadonlySet<BrainTileId>;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label="Brand DNA, Audience, Competitors and Market feed Mox, and Mox uses them in every post, video and article"
      className={cn(
        "ds-card hidden items-center gap-2 overflow-hidden px-5 py-3 text-foreground @2xl:flex [background-image:radial-gradient(60%_90%_at_50%_50%,hsl(150_90%_55%/0.10),transparent_70%)]",
        className,
      )}
    >
      <div aria-hidden className="flex h-[160px] flex-col justify-between py-1">
        {BRAIN_IN.map((b) => (
          <Chip
            key={b.id}
            label={b.label}
            icon={b.icon}
            dim={enabled ? !enabled.has(b.id) : false}
          />
        ))}
      </div>
      <Wires from={[20, 60, 100, 140]} to={[80]} />
      <div aria-hidden className="relative flex h-[160px] flex-col items-center justify-center">
        <span className="relative grid size-[76px] place-items-center rounded-full bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow)] ring-1 ring-[var(--ds-card-border)]">
          <span className="home-blink absolute -inset-1.5 rounded-full ring-2 ring-[#3fe46e]/40" />
          <MoxFace mood="thinking" size={58} />
        </span>
        <span className="absolute bottom-0 inline-flex items-center gap-1 whitespace-nowrap text-[10.5px] font-bold text-muted-foreground">
          <Compass className="size-3" /> + your strategy
        </span>
      </div>
      <Wires from={[80]} to={[27, 80, 133]} />
      <div aria-hidden className="flex h-[160px] flex-col justify-around">
        {BRAIN_OUT.map((o) => (
          <Chip key={o.label} label={o.label} icon={o.icon} />
        ))}
      </div>
    </div>
  );
}

/* ── Creator video: a Reel playing ───────────────────────────────────── */

export function CreatorPhone({ photo, hook }: { photo: string; hook: string }) {
  return (
    <span
      aria-hidden
      className="relative block h-[168px] w-[96px] shrink-0 overflow-hidden rounded-[20px] border-[3px] border-foreground/85 bg-foreground shadow-[0_12px_30px_-12px_hsl(220_30%_10%/0.45)] transition-transform duration-500 group-hover:-translate-y-1 group-hover:rotate-[-2deg]"
    >
      <img
        src={photo}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
      <span className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/55" />
      <span className="home-hook absolute inset-x-2 top-[42%] rounded-md bg-white px-1.5 py-1 text-center text-[9px] font-extrabold leading-tight text-black shadow">
        {hook}
      </span>
      <span className="absolute left-1/2 top-[22%] grid size-7 -translate-x-1/2 place-items-center rounded-full bg-white/25 text-white backdrop-blur-sm transition-transform duration-300 group-hover:scale-110">
        <Play className="size-3.5" />
      </span>
      <span className="absolute inset-x-2 bottom-2 h-[3px] overflow-hidden rounded-full bg-white/30">
        <span className="home-play block h-full w-full rounded-full [background:var(--mox-gradient)]" />
      </span>
    </span>
  );
}

/* ── What to finish, and what is new ─────────────────────────────────── */

export function NeedsAndNews({
  needs,
  updates,
  onOpen,
}: {
  needs: HomeNeed[];
  updates: HomeUpdate[];
  onOpen: (brain: BrainTileId) => void;
}) {
  if (!needs.length && !updates.length) return null;
  return (
    <div className="grid grid-cols-1 gap-2.5 @xl:grid-cols-2">
      {needs.length ? (
        <div className="ds-card ds-rise p-4" style={vars({ "--i": "1" })}>
          <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            To finish
          </p>
          <ul className="mt-2 flex flex-col">
            {needs.map((n, i) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onOpen(n.brain)}
                  className="group flex w-full items-center gap-2.5 rounded-[12px] px-1.5 py-1.5 text-left text-[13px] font-semibold transition-colors hover:bg-[var(--ds-well-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span
                    className="home-blink grid size-5 shrink-0 place-items-center rounded-full border-2 border-dashed border-foreground/30"
                    style={vars({ "--d": `${i * 0.4}s` })}
                  />
                  <span className="min-w-0 flex-1 truncate">{n.label}</span>
                  <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {updates.length ? (
        <div className="ds-card ds-rise p-4" style={vars({ "--i": "2" })}>
          <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#3fe46e] opacity-50 motion-reduce:hidden" />
              <span className="relative inline-flex size-2 rounded-full bg-[#3fe46e]" />
            </span>
            Lately
          </p>
          <ul className="mt-2 flex flex-col">
            {updates.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => onOpen(u.brain)}
                  className="group flex w-full items-center gap-2.5 rounded-[12px] px-1.5 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--ds-well-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{u.title}</span>
                  {u.when ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {u.when}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
