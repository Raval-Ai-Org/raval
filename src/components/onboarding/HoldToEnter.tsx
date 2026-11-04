"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import { cn } from "@/lib/utils";

const HOLD_MS = 1200;

/**
 * Onboarding's last button (Mellox 2.0, Holo's finish): press and hold to go
 * in. The pill fills over 1.2 s; letting go early drains it. Space or Enter
 * held works the same; a click from assistive tech (no press) goes straight in.
 */
export function HoldToEnter({
  onDone,
  label = "Press & hold to enter",
  className,
}: {
  onDone: () => void;
  label?: string;
  className?: string;
}) {
  const [fill, setFill] = useState(0);
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
      ? Math.min(1, value.current + dt / HOLD_MS)
      : Math.max(0, value.current - dt / (HOLD_MS / 2.5));
    value.current = next;
    setFill(next);
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
    if (!holding.current) return;
    holding.current = false;
    last.current = 0;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

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
      onPointerLeave={end}
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
        "group relative isolate inline-flex h-14 touch-none select-none items-center gap-3 overflow-hidden rounded-full bg-[var(--mox-ink)] pl-2 pr-6 text-[15px] font-bold text-white shadow-[0_18px_40px_-18px_rgb(22_25_27/0.7)] transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40 dark:bg-white dark:text-[var(--mox-ink)]",
        className,
      )}
      style={{ transform: `scale(${1 + fill * 0.04})` }}
    >
      <span
        aria-hidden
        className="ds-grad-bar absolute inset-y-0 left-0 -z-10"
        style={{ width: `${fill * 100}%` }}
      />
      <span
        aria-hidden
        className="grid size-10 place-items-center rounded-full bg-white/95"
        style={{ boxShadow: `0 0 ${8 + fill * 26}px rgba(46,230,107,${0.3 + fill * 0.6})` }}
      >
        <MoxFace mood={fill > 0 ? "scanning" : "happy"} visor={fill > 0} size={34} />
      </span>
      <span className={cn("relative transition-colors", fill > 0.45 && "text-[var(--mox-ink)]")}>
        {fill > 0 ? "Keep holding…" : label}
      </span>
    </button>
  );
}
