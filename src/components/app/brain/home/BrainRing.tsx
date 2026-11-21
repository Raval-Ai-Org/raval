"use client";

// The four brains as one ring (Mellox 2.0, Holo's DNA ring): Brand,
// Audience, Competitors and Market are the four quarters, Mox sits in the
// middle with how much Mellox knows overall. Each quarter opens its brain.
// Presentational, like BrainHome. The brains keep their own colours.

import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import { ChevronRight, Lock } from "@/components/icons";
import { dsFocus } from "@/components/app/surface/buttons";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import { BRAINS, BRAIN_META, type BrainId, type BrainOverview } from "@/lib/brain/brain";
import { cn } from "@/lib/utils";
import { BrainMark } from "../BrainMark";

const EASE = [0.16, 1, 0.3, 1] as const;

// Clockwise from the top left. `pad` pushes the label toward the outer edge;
// `origin` is the ring's centre, so a quarter grows outward from it.
const PLACE: Record<BrainId, { box: string; radius: string; pad: string; origin: string }> = {
  brand: {
    box: "left-0 top-0",
    radius: "rounded-tl-full",
    pad: "pb-[8%] pr-[8%]",
    origin: "100% 100%",
  },
  audience: {
    box: "right-0 top-0",
    radius: "rounded-tr-full",
    pad: "pb-[8%] pl-[8%]",
    origin: "0% 100%",
  },
  market: {
    box: "right-0 bottom-0",
    radius: "rounded-br-full",
    pad: "pt-[8%] pl-[8%]",
    origin: "0% 0%",
  },
  competitors: {
    box: "left-0 bottom-0",
    radius: "rounded-bl-full",
    pad: "pt-[8%] pr-[8%]",
    origin: "100% 0%",
  },
};
// Hover answers at once and settles softly; only the entrance is staggered.
const HOVER = { type: "spring", stiffness: 380, damping: 26 } as const;

export function BrainRing({
  overview,
  news,
  locked = {},
  onOpen,
}: {
  overview: BrainOverview;
  news: Record<BrainId | "strategy", number>;
  locked?: Partial<Record<BrainId, string>>;
  onOpen: (brain: BrainId) => void;
}) {
  const known = Math.round(
    BRAINS.reduce((sum, b) => sum + overview.brains[b].health, 0) / BRAINS.length,
  );
  return (
    <div className="relative mx-auto mb-6 mt-3 aspect-square w-full max-w-[min(100%,460px)]">
      {/* A slow ring of light around it all, evenly spaced from the quarters. */}
      <span aria-hidden className="mox-orbit absolute -inset-[7px] rounded-full opacity-50" />
      {BRAINS.map((brain, i) => {
        const meta = BRAIN_META[brain];
        const card = overview.brains[brain];
        const plan = locked[brain];
        const p = PLACE[brain];
        const count = news[brain];
        const line = plan ? `${plan} plan` : card.headline;
        return (
          <motion.button
            key={brain}
            type="button"
            onClick={() => onOpen(brain)}
            aria-label={`${meta.label}: ${line}${count ? `, ${count} new` : ""}`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{
              opacity: 1,
              scale: 1,
              transition: { duration: 0.5, delay: 0.05 + i * 0.06, ease: EASE },
            }}
            whileHover={{ scale: 1.035, transition: HOVER }}
            whileTap={{ scale: 0.985, transition: HOVER }}
            style={
              {
                "--b": meta.color,
                transformOrigin: p.origin,
                background: `radial-gradient(120% 120% at 50% 50%, color-mix(in srgb, ${meta.color} 10%, var(--ds-card-bg)), color-mix(in srgb, ${meta.color} 22%, var(--ds-card-bg)))`,
                borderColor: `color-mix(in srgb, ${meta.color} 26%, transparent)`,
              } as CSSProperties
            }
            className={cn(
              "group absolute flex h-[calc(50%-4px)] w-[calc(50%-4px)] flex-col items-center justify-center border text-center transition-shadow duration-300 hover:shadow-[0_22px_44px_-22px_var(--b)]",
              p.box,
              p.radius,
              p.pad,
              dsFocus,
            )}
          >
            <span className="relative grid size-11 place-items-center rounded-2xl bg-[var(--ds-card-bg)] shadow-[0_6px_16px_-8px_var(--b)] transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-110 sm:size-12">
              <BrainMark brain={brain} size={24} active={count > 0} muted={!card.ready} />
              {count > 0 && (
                <span className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10.5px] font-bold text-primary-foreground">
                  {count > 9 ? "9+" : count}
                </span>
              )}
            </span>
            <span className="mt-2 flex items-center gap-0.5 text-[15px] font-bold tracking-tight sm:text-[17px]">
              {meta.label}
              <ChevronRight
                className="size-4 opacity-50 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100"
                aria-hidden
              />
            </span>
            {!card.ready && !plan && (
              // An empty brain says what to do first.
              <span className="mt-0.5 line-clamp-2 max-w-[70%] text-[11.5px] font-medium leading-4 text-muted-foreground">
                {card.headline}
              </span>
            )}
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[var(--ds-card-bg)]/80 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-foreground/75">
              {plan ? (
                <>
                  <Lock className="size-3" aria-hidden /> {plan} plan
                </>
              ) : (
                <>
                  <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
                  {card.health}%
                </>
              )}
            </span>
          </motion.button>
        );
      })}

      {/* Mox in the middle: how much Mellox knows, all four together. */}
      <motion.div
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.35 }}
        className="pointer-events-none absolute left-1/2 top-1/2 grid aspect-square w-[40%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--ds-frame-bg)] shadow-[0_0_0_8px_var(--ds-frame-bg),0_18px_40px_-18px_rgb(15_120_70/0.45)]"
      >
        <span className="flex flex-col items-center">
          <MoxFace mood={known >= 60 ? "happy" : "thinking"} size={72} track />
          <span className="mt-0.5 text-[20px] font-bold tabular-nums leading-none tracking-tight sm:text-[24px]">
            <span className="ds-grad-text">{known}%</span>
          </span>
          <span className="mt-1 text-[11px] font-semibold text-muted-foreground">known</span>
        </span>
      </motion.div>
    </div>
  );
}
