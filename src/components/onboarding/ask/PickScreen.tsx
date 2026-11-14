"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { motion } from "framer-motion";
import { Check, Star } from "@/components/icons";
import type { Option, PickScreen as Screen } from "@/lib/onboarding/questions";
import { cn } from "@/lib/utils";
import { CardArt } from "./CardArt";
import { Highlighted } from "./text";

/** How long the picked card holds before the next screen comes in. */
export const PICK_BEAT_MS = 420;

/**
 * One question, a few big cards; a tap answers and moves on (Native's
 * pattern). The picked card presses in and its picture flies into the answer
 * trail (`layoutId`), the others drop away. Keys 1–9 pick.
 */
export function PickScreen({
  screen,
  value,
  reduce,
  headingRef,
  onPick,
}: {
  screen: Screen;
  value: string | number | undefined;
  reduce: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onPick: (value: string | number) => void;
}) {
  const [picked, setPicked] = useState<string | number | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);

  // "Let Mox decide" sits under the grid as a wide card when the grid is full.
  const last = screen.options.at(-1);
  const wideLast =
    last?.art.kind === "mox" && screen.options.length % screen.columns === 1 ? last : null;
  const grid = wideLast ? screen.options.slice(0, -1) : screen.options;

  const choose = (o: Option) => {
    if (picked !== null) return;
    setPicked(o.value);
    timer.current = window.setTimeout(() => onPick(o.value), reduce ? 60 : PICK_BEAT_MS);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest("input,textarea,[contenteditable]")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= screen.options.length) {
        e.preventDefault();
        choose(screen.options[n - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.id, picked]);

  const rows = Math.ceil(grid.length / screen.columns);
  const phoneCols = grid.length === 3 ? 3 : 2;
  const phoneRows = Math.ceil(grid.length / phoneCols);

  return (
    <div className="flex h-full min-h-0 flex-col items-center">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="ob-title shrink-0 px-2 text-center outline-none"
      >
        <Highlighted text={screen.title} />
      </h1>
      {screen.sub && (
        <p className="mt-1.5 shrink-0 px-4 text-center text-[13px] text-muted-foreground sm:text-[14px]">
          {screen.sub}
        </p>
      )}
      <div className="mt-4 flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 sm:mt-6">
        <div
          role="radiogroup"
          aria-label={screen.title.replace(/\*\*/g, "")}
          className="ob-grid grid min-h-0 w-full gap-2.5 sm:gap-3.5"
          style={
            {
              "--cols": screen.columns,
              "--rows": rows,
              "--pcols": phoneCols,
              "--prows": phoneRows,
            } as React.CSSProperties
          }
        >
          {grid.map((o, i) => (
            <OptionCard
              key={String(o.value)}
              screenId={screen.id}
              option={o}
              index={i}
              selected={picked === null ? value === o.value : picked === o.value}
              state={picked === null ? "idle" : picked === o.value ? "picked" : "away"}
              reduce={reduce}
              onClick={() => choose(o)}
            />
          ))}
        </div>
        {wideLast && (
          <OptionCard
            screenId={screen.id}
            option={wideLast}
            index={grid.length}
            wide
            selected={picked === null ? value === wideLast.value : picked === wideLast.value}
            state={picked === null ? "idle" : picked === wideLast.value ? "picked" : "away"}
            reduce={reduce}
            onClick={() => choose(wideLast)}
          />
        )}
      </div>
    </div>
  );
}

function OptionCard({
  screenId,
  option,
  index,
  selected,
  state,
  wide,
  reduce,
  onClick,
}: {
  screenId: string;
  option: Option;
  index: number;
  selected: boolean;
  state: "idle" | "picked" | "away";
  wide?: boolean;
  reduce: boolean;
  onClick: () => void;
}) {
  const art = (
    <motion.span
      layoutId={state === "picked" && !reduce ? `ob-answer-${screenId}` : undefined}
      className={cn(
        "ob-card-art relative block min-h-0",
        wide ? "size-12 shrink-0" : "w-full flex-1",
      )}
    >
      <CardArt art={option.art} active={state === "picked" || selected} />
    </motion.span>
  );
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.94 }}
      animate={
        state === "away"
          ? reduce
            ? { opacity: 0.3 }
            : { opacity: 0, y: 26, scale: 0.9 }
          : state === "picked"
            ? reduce
              ? { opacity: 1 }
              : { opacity: 1, y: -4, scale: [1, 0.93, 1.04] }
            : { opacity: 1, y: 0, scale: 1 }
      }
      transition={
        state === "idle"
          ? { delay: reduce ? 0 : 0.08 + index * 0.05, type: "spring", stiffness: 260, damping: 22 }
          : state === "away"
            ? { delay: index * 0.03, duration: 0.28, ease: [0.4, 0, 1, 1] }
            : { duration: 0.42, ease: [0.16, 1, 0.3, 1] }
      }
      whileHover={reduce || state !== "idle" ? undefined : { y: -4 }}
      whileTap={reduce ? undefined : { scale: 0.96 }}
      className={cn(
        "ob-card group relative isolate flex min-h-0 overflow-hidden text-left outline-none",
        wide
          ? "w-full max-w-[420px] shrink-0 flex-row items-center gap-3 rounded-full px-3 py-2"
          : "flex-col items-stretch rounded-[22px] p-2 sm:rounded-[26px] sm:p-2.5",
        selected && "ob-card-on",
      )}
    >
      {/* The glow that sweeps the card on hover and blooms on a pick. */}
      <span aria-hidden className="ob-card-sheen pointer-events-none absolute inset-0 -z-10" />
      {art}
      <span
        className={cn(
          "relative flex items-center gap-1.5",
          wide ? "flex-1 justify-center pr-10" : "justify-center px-1 pb-1 pt-1.5 text-center",
        )}
      >
        {option.recommended && (
          <Star
            className="size-3.5 shrink-0 fill-[var(--mox-green)] text-[var(--mox-green)]"
            aria-hidden
          />
        )}
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold leading-tight sm:text-[14px]">
            {option.label}
          </span>
          {option.hint && (
            <span className="ob-card-hint mt-0.5 block truncate text-[11.5px] leading-tight text-muted-foreground">
              {option.hint}
            </span>
          )}
        </span>
        {option.recommended && (
          <Star
            className="size-3.5 shrink-0 fill-[var(--mox-green)] text-[var(--mox-green)]"
            aria-hidden
          />
        )}
      </span>
      {option.recommended && !wide && (
        <span className="absolute right-2.5 top-2.5 rounded-full bg-card/90 px-2 py-0.5 text-[10px] font-semibold text-foreground/70 shadow-sm backdrop-blur">
          Mox suggests
        </span>
      )}
      <span
        aria-hidden
        className={cn(
          "absolute grid size-6 place-items-center rounded-full transition-all duration-300",
          wide ? "right-3 top-1/2 -translate-y-1/2" : "left-2.5 top-2.5",
          selected
            ? "scale-100 bg-primary text-primary-foreground opacity-100"
            : "scale-50 opacity-0",
        )}
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
      <span
        aria-hidden
        className="absolute bottom-2 right-3 hidden text-[10px] font-semibold text-muted-foreground/60 lg:block"
      >
        {index + 1}
      </span>
    </motion.button>
  );
}
