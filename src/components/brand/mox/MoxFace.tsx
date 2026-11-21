"use client";

// Mox at icon size, made from the same 3D renders as the big poses (never a
// hand-drawn look-alike), so Mox looks the same everywhere. Mox shows his
// face, and puts the VR headset on only while working (thinking, scanning).
// Life comes from motion: a gentle breathing bob, a light sweep across the
// visor, a head tilt toward the pointer, and a small badge per mood
// (thinking dots, a sleepy "z", sparkles). Reduced motion keeps it still.

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type MoxMood = "happy" | "thinking" | "wow" | "sad" | "sleep" | "excited" | "scanning";

// The headset is for working (thinking, scanning); otherwise Mox shows his face.
const WORKING: MoxMood[] = ["thinking", "scanning"];

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.chatMotion === "reduced"
    );
  } catch {
    return false;
  }
}

export function MoxFace({
  mood = "happy",
  size = 40,
  visor,
  track = false,
  className,
  title,
}: {
  mood?: MoxMood;
  size?: number;
  /** Wear the VR headset. Default: only while thinking or scanning. */
  visor?: boolean;
  /** The head turns a little toward the pointer. */
  track?: boolean;
  className?: string;
  /** Accessible name; decorative when omitted. */
  title?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [lean, setLean] = useState({ x: 0, y: 0 });
  const withVisor = visor ?? WORKING.includes(mood);

  useEffect(() => {
    if (!track || prefersReducedMotion()) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const reach = Math.min(1, Math.hypot(dx, dy) / 420);
        const d = Math.max(1, Math.hypot(dx, dy));
        setLean({ x: (dx / d) * reach, y: (dy / d) * reach });
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, [track]);

  const small = size < 30;

  return (
    <span
      ref={ref}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-mood={mood}
      className={cn("mox-face relative inline-block shrink-0 select-none", className)}
      style={{ width: size, height: size }}
    >
      <span
        className={cn("mox-head absolute inset-0 block", `mox-head-${mood}`)}
        style={{
          transform: `translate(${lean.x * size * 0.04}px, ${lean.y * size * 0.03}px) rotate(${lean.x * 6}deg)`,
          transition: "transform 260ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <span className="mox-breathe absolute inset-0 block">
          <img
            src={withVisor ? "/brand/mox/visor-head.webp" : "/brand/mox/face-head.webp"}
            alt=""
            width={size}
            height={size}
            draggable={false}
            decoding="async"
            className={cn(
              "block h-full w-full object-contain drop-shadow-[0_3px_6px_rgb(20_40_20/0.18)]",
              mood === "sleep" && "brightness-[0.92] saturate-[0.8]",
              mood === "sad" && "saturate-[0.75]",
            )}
          />
          {withVisor && !small && (
            // The light that sweeps across the glass (faster while working).
            <span
              aria-hidden
              className={cn(
                "mox-visor-glint absolute overflow-hidden rounded-[42%]",
                (mood === "thinking" || mood === "scanning") && "mox-visor-busy",
                mood === "sleep" && "opacity-0",
              )}
              style={{ left: "14%", top: "38%", width: "72%", height: "34%" }}
            />
          )}
        </span>
      </span>

      {!small && <MoodBadge mood={mood} size={size} />}
    </span>
  );
}

function MoodBadge({ mood, size }: { mood: MoxMood; size: number }) {
  const s = Math.max(10, Math.round(size * 0.26));
  if (mood === "thinking" || mood === "scanning") {
    return (
      <span
        aria-hidden
        className="mox-think absolute -right-[6%] -top-[4%] flex items-center gap-[2px] rounded-full bg-white px-[4px] py-[3px] shadow-[0_2px_8px_rgb(0_0_0/0.12)]"
        style={{ height: s * 0.7 }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block rounded-full bg-[#16191B]"
            style={{
              width: s * 0.16,
              height: s * 0.16,
              animation: `mox-dot 1.1s ${i * 0.16}s ease-in-out infinite`,
            }}
          />
        ))}
      </span>
    );
  }
  if (mood === "sleep") {
    return (
      <span
        aria-hidden
        className="mox-zzz absolute -right-[2%] -top-[6%] font-bold text-[#16191B]/60"
        style={{ fontSize: s * 0.8 }}
      >
        z
      </span>
    );
  }
  if (mood === "wow" || mood === "excited") {
    return (
      <span aria-hidden className="absolute inset-0">
        {[
          { l: "-4%", t: "6%", d: 0 },
          { l: "88%", t: "0%", d: 0.35 },
          { l: "92%", t: "62%", d: 0.7 },
        ].map((p, i) => (
          <svg
            key={i}
            viewBox="0 0 10 10"
            className="mox-sparkle absolute"
            style={{
              left: p.l,
              top: p.t,
              width: s * 0.55,
              height: s * 0.55,
              animationDelay: `${p.d}s`,
            }}
          >
            <path d="M5 0 L6 4 L10 5 L6 6 L5 10 L4 6 L0 5 L4 4 Z" fill="#2EE66B" />
          </svg>
        ))}
      </span>
    );
  }
  return null;
}
