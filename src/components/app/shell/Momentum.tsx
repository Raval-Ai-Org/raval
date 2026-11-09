"use client";

// The top bar's momentum (Holo's streak chip and "improves with every piece"
// line), from finished Studio pieces in the free workspace pulse
// (src/lib/home/momentum.ts). It only reads; a click opens Create. The views
// are presentational so `/home-lab` can show every state.

import { useEffect, useMemo, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useWorkspacePulse } from "@/components/app/pulse/use-pulse";
import { GradProgress } from "@/components/app/surface/MoxParts";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { emitAppEvent } from "@/lib/app-events";
import { celebrate } from "@/lib/celebrate";
import { levelledUp, localDay, momentum, streakLabel, type Momentum } from "@/lib/home/momentum";
import { cn } from "@/lib/utils";

/** The workspace's momentum, or null until the pulse has a real count. */
export function useMomentum(workspaceId: string): Momentum | null {
  const { data } = useWorkspacePulse(workspaceId);
  const made = data?.made ?? null;
  return useMemo(() => {
    if (!made) return null;
    return momentum({
      days: made.recent.map((at) => localDay(new Date(at))),
      total: made.total,
      today: localDay(new Date()),
    });
  }, [made]);
}

/** A small warm flame; grey until a streak is going. */
export function FlameMark({ lit, className }: { lit: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 16 20" aria-hidden className={cn("h-4 w-[13px] shrink-0", className)}>
      <defs>
        <linearGradient id="mox-flame" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#FF5A1F" />
          <stop offset="0.6" stopColor="#FF9F1C" />
          <stop offset="1" stopColor="#FFD23F" />
        </linearGradient>
      </defs>
      <path
        d="M8 1c.6 3-2.6 4.6-3.6 7.2C3 11.6 4.3 14 5.6 14.6 4.9 12.6 6.3 11 7.4 10c.2 2.1 1.7 2.7 2.4 4.4.6-1 .6-2.3.2-3.4 2 1.3 2.4 3.6 1.4 5.6C13.6 15.7 15 13.6 15 11 15 6.6 11 4.5 8 1Z"
        transform="translate(-1.5 1.5)"
        fill={lit ? "url(#mox-flame)" : "currentColor"}
        className={lit ? undefined : "text-foreground/25"}
      />
      <path
        d="M8.2 19c-2 0-3.4-1.4-3.4-3.2 0-1.6 1.1-2.4 2-3.4.2 1.1.9 1.6 1.6 2 .3-.6.4-1.3.2-2 1.6.9 2.6 2 2.6 3.5 0 1.8-1.3 3.1-3 3.1Z"
        transform="translate(-0.2 -0.5)"
        fill={lit ? "#FFE28A" : "currentColor"}
        className={lit ? undefined : "text-foreground/15"}
      />
    </svg>
  );
}

const DAY = new Intl.DateTimeFormat([], { weekday: "narrow" });

/** Holo's "Start your streak!" chip, with the last seven days in its popover. */
export function StreakChipView({ m, className }: { m: Momentum; className?: string }) {
  const reduce = useReducedMotion();
  const lit = m.streak > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${streakLabel(m)}. See this week`}
          className={cn(
            "group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            lit && !m.atRisk
              ? "border-[#FFD6B8] bg-[#FFF3EA] text-[#B4410F] dark:border-[#6B3216] dark:bg-[#2A160B] dark:text-[#FFB27A]"
              : "border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] text-[#C2410C] shadow-[var(--ds-card-shadow)] dark:text-[#FF9F5A]",
            className,
          )}
        >
          <motion.span
            animate={lit && !reduce ? { scale: [1, 1.12, 1], rotate: [0, -4, 0] } : undefined}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            className="inline-flex"
          >
            <FlameMark lit={lit} />
          </motion.span>
          <span className="whitespace-nowrap">{streakLabel(m)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[264px] rounded-2xl p-4">
        <div className="flex items-center gap-2">
          <FlameMark lit={lit} className="h-5 w-4" />
          <p className="text-[14px] font-bold tracking-[-0.01em]">
            {lit ? `${m.streak} day${m.streak === 1 ? "" : "s"} in a row` : "No streak yet"}
          </p>
        </div>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          {m.madeToday
            ? "You made something today. Come back tomorrow to keep it going."
            : lit
              ? "Make one piece today to keep your streak."
              : "Make one piece a day and Mox learns your brand faster."}
        </p>
        <ol className="mt-3 grid grid-cols-7 gap-1" aria-label="This week">
          {m.week.map((d, i) => {
            const [y, mo, da] = d.day.split("-").map(Number);
            const today = i === m.week.length - 1;
            return (
              <li key={d.day} className="flex flex-col items-center gap-1">
                <span
                  className={cn(
                    "grid size-7 place-items-center rounded-full text-[10px] font-bold",
                    d.made
                      ? "bg-gradient-to-b from-[#FFB347] to-[#FF6A2B] text-white shadow-[0_4px_10px_-4px_#FF6A2B]"
                      : "bg-[var(--ds-well-bg)] text-foreground/35",
                    today &&
                      !d.made &&
                      "outline-dashed outline-2 outline-offset-1 outline-[#FF9F1C]/60",
                  )}
                  aria-label={`${d.day}: ${d.made ? "made something" : "nothing made"}`}
                >
                  {d.made ? "✓" : ""}
                </span>
                <span
                  className={cn(
                    "text-[10px] text-muted-foreground",
                    today && "font-bold text-foreground",
                  )}
                >
                  {DAY.format(new Date(y, mo - 1, da))}
                </span>
              </li>
            );
          })}
        </ol>
        {/* The level: pieces made towards the next one (Holo's 0/25). */}
        <div className="mt-3.5 rounded-xl bg-[var(--ds-well-bg)] p-3">
          <div className="flex items-center gap-2">
            <MoxFace mood={m.madeToday ? "excited" : "happy"} size={22} />
            <p className="min-w-0 flex-1 text-[12px] font-semibold leading-tight">
              Mox gets better with every piece
            </p>
            <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-[var(--mox-ink)] [background:var(--mox-gradient)]">
              Lv {m.level.index}
            </span>
          </div>
          <GradProgress
            value={m.level.progress}
            label="Pieces to the next level"
            className="mt-2 h-1.5"
          />
          <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
            {m.level.maxed
              ? `${m.total} pieces made`
              : `${m.total}/${m.level.goal} pieces · ${m.level.goal - m.total} to level ${m.level.index + 1}`}
          </p>
        </div>
        {!m.madeToday && (
          <button
            type="button"
            onClick={() => emitAppEvent("open:create-launcher")}
            className="studio-cta mt-3.5 inline-flex h-9 w-full items-center justify-center rounded-full text-[12.5px] font-bold"
          >
            Make something
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Confetti when a level is reached while the person watches, never on load. */
export function useLevelCelebration(m: Momentum | null) {
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!m) return;
    if (seen.current !== null && levelledUp(seen.current, m.total)) celebrate();
    seen.current = m.total;
  }, [m]);
}

export function StreakChip({
  workspaceId,
  className,
}: {
  workspaceId: string;
  className?: string;
}) {
  const m = useMomentum(workspaceId);
  useLevelCelebration(m);
  if (!m) return null;
  return <StreakChipView m={m} className={className} />;
}
