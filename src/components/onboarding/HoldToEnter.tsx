"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

const HOLD_MS = 1200;
const RING = 2 * Math.PI * 15;

/**
 * Onboarding's last button (Mellox 2.0, Holo's finish): press and hold to go
 * in. A ring and the pill fill over 1.2 s; letting go early drains them.
 * Space or Enter held works the same; a click from assistive tech (no press)
 * goes straight in. `onProgress` lets the page react while it fills. With
 * `autoAfterMs`, nobody pressing means it fills by itself and goes in (Holo).
 */
export function HoldToEnter({
  onDone,
  onProgress,
  autoAfterMs,
  onHoverChange,
  label = "Hold to enter",
  className,
}: {
  onDone: () => void;
  onProgress?: (value: number) => void;
  /** Go in by itself after this long without a press. */
  autoAfterMs?: number;
  /** The pointer is over the button (the page can react). */
  onHoverChange?: (over: boolean) => void;
  label?: string;
  className?: string;
}) {
  const [fill, setFill] = useState(0);
  const [auto, setAuto] = useState(false);
  const autoRef = useRef(false);
  const holding = useRef(false);
  const pressed = useRef(false);
  const fired = useRef(false);
  const value = useRef(0);
  const raf = useRef(0);
  const last = useRef(0);

  const tick = (t: number) => {
    const dt = last.current ? t - last.current : 16;
    last.current = t;
    const next = holding.current
      ? Math.min(
          1,
          value.current + dt / (autoRef.current && !pressed.current ? HOLD_MS * 1.6 : HOLD_MS),
        )
      : Math.max(0, value.current - dt / (HOLD_MS / 2.5));
    value.current = next;
    setFill(next);
    onProgress?.(next);
    if (next >= 1 && !fired.current) {
      fired.current = true;
      onDone();
      return;
    }
    if (holding.current || next > 0) raf.current = requestAnimationFrame(tick);
  };
  const begin = () => {
    if (fired.current) return;
    holding.current = true;
    pressed.current = true;
    last.current = 0;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  };
  const end = () => {
    // Letting go never stops the automatic entry.
    if (!holding.current || autoRef.current) return;
    holding.current = false;
    last.current = 0;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => {
    if (!autoAfterMs) return;
    const timer = window.setTimeout(() => {
      if (fired.current || holding.current) return;
      autoRef.current = true;
      setAuto(true);
      holding.current = true;
      last.current = 0;
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(tick);
    }, autoAfterMs);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAfterMs]);

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      begin();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      end();
    }
  };

  return (
    <button
      type="button"
      aria-label="Press and hold to enter Mellox"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        begin();
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerEnter={() => onHoverChange?.(true)}
      onPointerLeave={() => {
        onHoverChange?.(false);
        end();
      }}
      onFocus={() => onHoverChange?.(true)}
      onBlur={() => onHoverChange?.(false)}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onClick={(e) => {
        // Screen readers activate with a click and no press.
        if (e.detail === 0 && !pressed.current && !fired.current) {
          fired.current = true;
          onDone();
        }
        pressed.current = false;
      }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "group relative isolate inline-flex h-11 touch-none select-none items-center gap-2 overflow-hidden rounded-full bg-[var(--mox-ink)] pl-1.5 pr-5 text-[13.5px] font-bold text-white shadow-[0_18px_40px_-18px_rgb(22_25_27/0.7)] transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 dark:bg-white dark:text-[var(--mox-ink)]",
        fill === 0 && "mox-hold-idle",
        className,
      )}
      style={{ transform: `scale(${1 + fill * 0.05})` }}
    >
      <span
        aria-hidden
        className="ds-grad-bar absolute inset-y-0 left-0 -z-10"
        style={{ width: `${fill * 100}%` }}
      />
      {/* A ring that closes as you hold. */}
      <svg aria-hidden viewBox="0 0 36 36" className="size-8 -rotate-90">
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          strokeWidth="3"
          className="stroke-current opacity-20"
        />
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          stroke="var(--mox-green)"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - fill)}
          className={cn(fill > 0.45 && "stroke-[var(--mox-ink)]")}
        />
      </svg>
      <span className={cn("relative transition-colors", fill > 0.45 && "text-[var(--mox-ink)]")}>
        {auto ? "Taking you in" : fill > 0 ? "Keep holding" : label}
      </span>
    </button>
  );
}
