"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BrainMark } from "@/components/app/brain/BrainMark";
import { Check, RefreshCw } from "@/components/icons";
import type { Discoveries } from "@/lib/brand-extract-events";
import { BRAINS, BRAIN_META, type BrainId } from "@/lib/brain/brain";
import { brainFill, foundSoFar, type ScanState } from "@/lib/onboarding/brains";
import { cn } from "@/lib/utils";
import { SCAN_PHASES } from "../phases";
import { BrandMark } from "../ui";
import { hostOf } from "../url";

/**
 * The scan, as a glass pill at the bottom (Native's pattern), so nobody
 * waits for it: the four brains fill as the server really moves through its
 * parts, the current line changes with the server's own message, and what
 * was found pops in. `flash` (a counter) shows "Added to Brand DNA" after
 * each answer. Tap opens a small panel with each brain.
 */
export function ScanDock({
  url,
  status,
  pct,
  phase,
  message,
  discoveries,
  flash,
  reduce,
  onRetry,
}: {
  url: string;
  status: ScanState;
  pct: number;
  phase: number;
  message?: string;
  discoveries: Discoveries;
  flash: number;
  reduce: boolean;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!flash) return;
    setFlashing(true);
    const t = window.setTimeout(() => setFlashing(false), 1400);
    return () => window.clearTimeout(t);
  }, [flash]);

  const fill = brainFill(status, phase, pct, discoveries);
  const failed = status === "error";
  const done = status === "ok";
  const site = discoveries.site;
  const name = site?.siteName || hostOf(url);
  const found = foundSoFar(discoveries);
  const colors = (discoveries.identity?.colors ?? []).slice(0, 4);
  const line = failed
    ? "The scan didn't finish"
    : done
      ? "Brand DNA ready"
      : SCAN_PHASES[Math.min(Math.max(phase, 0), SCAN_PHASES.length - 1)].label;
  const sub = flashing ? "Saved for your posts" : done ? (found ?? name) : message || found || name;

  return (
    <div className="relative" role="status" aria-live="polite">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            className="ob-glass absolute bottom-[calc(100%+10px)] left-1/2 z-30 w-[min(92vw,360px)] -translate-x-1/2 rounded-[24px] p-3"
          >
            <p className="px-1 pb-2 text-[12px] font-semibold text-muted-foreground">
              What Mox is learning about {name}
            </p>
            <ul className="grid grid-cols-2 gap-2">
              {BRAINS.map((b) => (
                <li key={b} className="flex items-center gap-2 rounded-2xl bg-card/80 p-2">
                  <BrainRing brain={b} value={fill[b]} size={34} reduce={reduce} />
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold">{BRAIN_META[b].label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {fill[b] >= 1 ? "Ready" : fill[b] > 0 ? "Learning…" : "Waiting"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {colors.length > 0 && (
              <div className="mt-2 flex items-center gap-1.5 px-1">
                <span className="text-[11px] text-muted-foreground">Colours</span>
                {colors.map((c) => (
                  <span
                    key={c}
                    className="size-4 rounded-full border border-black/10"
                    style={{ background: c }}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        layout
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: flashing && !reduce ? [1, 1.04, 1] : 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        className={cn(
          "ob-glass flex h-12 max-w-[min(64vw,420px)] items-center gap-2.5 rounded-full pl-1.5 pr-3 text-left sm:h-14 sm:pr-4",
          flashing && "ob-glass-flash",
        )}
      >
        <BrandMark
          sources={[site?.logoUrl, site?.faviconUrl]}
          name={name}
          size={reduce ? 34 : 36}
        />
        <span className="hidden items-center -space-x-1 min-[380px]:flex">
          {BRAINS.map((b, i) => (
            <BrainRing
              key={b}
              brain={b}
              value={fill[b]}
              size={24}
              reduce={reduce}
              delay={i * 0.08}
            />
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-semibold leading-tight sm:text-[13px]">
            {line}
          </span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={sub}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
              className={cn(
                "block truncate text-[11px] leading-tight",
                flashing
                  ? "font-semibold text-[var(--mox-green-ink,#13803f)]"
                  : "text-muted-foreground",
              )}
            >
              {sub}
            </motion.span>
          </AnimatePresence>
        </span>
        {done ? (
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-3.5" strokeWidth={3} aria-hidden />
          </span>
        ) : failed ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onRetry();
              }
            }}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 text-[12px] font-medium hover:bg-secondary"
          >
            <RefreshCw className="size-3.5" aria-hidden /> Retry
          </span>
        ) : (
          <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-muted-foreground">
            {Math.round(pct)}%
          </span>
        )}
      </motion.button>
    </div>
  );
}

/** One brain's glyph inside a ring that fills in the brain's own colour. */
export function BrainRing({
  brain,
  value,
  size,
  reduce,
  delay = 0,
}: {
  brain: BrainId;
  value: number;
  size: number;
  reduce: boolean;
  delay?: number;
}) {
  const stroke = Math.max(2, size / 12);
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  const color = BRAIN_META[brain].color;
  const full = value >= 1;
  return (
    <span
      className="relative grid shrink-0 place-items-center rounded-full bg-card shadow-[0_0_0_2px_hsl(var(--card))]"
      style={{ width: size, height: size }}
      title={BRAIN_META[brain].label}
    >
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-foreground/[0.07]"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - Math.max(0.02, value)) }}
          transition={{ duration: reduce ? 0 : 0.9, ease: [0.16, 1, 0.3, 1], delay }}
        />
      </svg>
      <BrainMark
        brain={brain}
        size={Math.round(size * 0.52)}
        active={value > 0 && !full && !reduce}
        muted={value === 0}
      />
    </span>
  );
}
