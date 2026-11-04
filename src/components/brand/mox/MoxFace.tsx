"use client";

// Mox at icon size: a drawn head that blinks, looks toward the pointer and
// changes face with its mood. The 3D renders (`Mox`) are for heroes and
// empty states; this is for avatars, the credits gauge, loaders and toasts.
// Colours match the renders: lime hair, white face, ink eyes, green-ringed
// ear pods, and (with `visor`) the lime → green → teal headset.

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type MoxMood = "happy" | "thinking" | "wow" | "sad" | "sleep" | "excited" | "scanning";

const INK = "#16191B";

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
  visor = false,
  track = false,
  className,
  title,
}: {
  mood?: MoxMood;
  size?: number;
  /** Wear the VR headset (the scanning mood always does). */
  visor?: boolean;
  /** Eyes follow the pointer (±3 units). */
  track?: boolean;
  className?: string;
  /** Accessible name; decorative when omitted. */
  title?: string;
}) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<SVGSVGElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const withVisor = visor || mood === "scanning";

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
        const d = Math.max(1, Math.hypot(dx, dy));
        const reach = Math.min(1, d / 260);
        setLook({ x: (dx / d) * 3 * reach, y: (dy / d) * 2.2 * reach });
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, [track]);

  const gaze = mood === "thinking" ? { x: 2.5, y: -2.5 } : mood === "sleep" ? { x: 0, y: 0 } : look;

  return (
    <svg
      ref={ref}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("mox-face shrink-0 overflow-visible", className)}
      data-mood={mood}
    >
      <defs>
        <linearGradient id={`h${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E2FA7A" />
          <stop offset="0.55" stopColor="#C6F24E" />
          <stop offset="1" stopColor="#9BD62A" />
        </linearGradient>
        <radialGradient id={`f${id}`} cx="0.38" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.7" stopColor="#F3F4F2" />
          <stop offset="1" stopColor="#DCDFDB" />
        </radialGradient>
        <linearGradient id={`v${id}`} x1="0" y1="0" x2="1" y2="0.3">
          <stop offset="0" stopColor="#D9F53A" />
          <stop offset="0.5" stopColor="#2EE66B" />
          <stop offset="1" stopColor="#0E7F6E" />
        </linearGradient>
      </defs>

      {/* hair: the lime swoosh */}
      <path
        d="M30 34 C30 20 44 10 58 12 C66 6 74 2 80 2 C76 8 75 14 76 20 C80 26 78 34 72 38 Z"
        fill={`url(#h${id})`}
      />
      <path d="M34 30 C34 24 38 18 44 16 C42 22 42 26 44 30 Z" fill="#B6E53E" />

      {/* ear pods */}
      <g>
        <ellipse cx="17" cy="56" rx="8" ry="11" fill="#F1F2F0" />
        <ellipse cx="15" cy="56" rx="5" ry="8" fill={INK} />
        <ellipse cx="15" cy="56" rx="5.6" ry="8.6" fill="none" stroke="#38F070" strokeWidth="1.3" />
        <ellipse cx="83" cy="56" rx="8" ry="11" fill="#F1F2F0" />
        <ellipse cx="85" cy="56" rx="5" ry="8" fill={INK} />
        <ellipse cx="85" cy="56" rx="5.6" ry="8.6" fill="none" stroke="#38F070" strokeWidth="1.3" />
      </g>

      {/* head */}
      <path
        d="M50 26 C70 26 80 38 80 56 C80 74 68 86 50 86 C32 86 20 74 20 56 C20 38 30 26 50 26 Z"
        fill={`url(#f${id})`}
      />
      <path d="M38 28 C44 24 52 26 56 30 C50 29 44 29 38 28 Z" fill="#B6E53E" opacity="0.9" />

      {withVisor ? (
        <g>
          <rect x="24" y="42" width="52" height="22" rx="11" fill={INK} />
          <rect x="27" y="45" width="46" height="16" rx="8" fill={`url(#v${id})`}>
            <animate
              attributeName="opacity"
              values="0.85;1;0.85"
              dur="2.4s"
              repeatCount="indefinite"
            />
          </rect>
          <path
            d="M30 48 C38 46 46 46 52 48"
            stroke="#FFFFFF"
            strokeOpacity="0.55"
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />
          {mood === "scanning" && (
            <rect x="27" y="45" width="5" height="16" rx="2.5" fill="#FFFFFF" opacity="0.7">
              <animate attributeName="x" values="27;68;27" dur="1.6s" repeatCount="indefinite" />
            </rect>
          )}
          <path
            d="M43 72 Q50 77 57 72"
            stroke={INK}
            strokeWidth="2.6"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      ) : (
        <g>
          <Brows mood={mood} />
          <g
            style={{
              transform: `translate(${gaze.x}px, ${gaze.y}px)`,
              transition: "transform 180ms ease-out",
            }}
          >
            <Eyes mood={mood} />
          </g>
          <Mouth mood={mood} />
        </g>
      )}

      {mood === "sleep" && (
        <text x="74" y="30" fontSize="11" fontWeight="700" fill={INK} opacity="0.6">
          z
        </text>
      )}
    </svg>
  );
}

function Brows({ mood }: { mood: MoxMood }) {
  const tilt = mood === "sad" ? 3 : mood === "wow" ? -3 : mood === "thinking" ? -1.5 : 0;
  return (
    <g stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none">
      <path d={`M33 ${44 + tilt} Q38 ${41 - tilt} 43 ${43 - tilt * 0.3}`} />
      <path d={`M57 ${43 - tilt * 0.3} Q62 ${41 - tilt} 67 ${44 + tilt}`} />
    </g>
  );
}

function Eyes({ mood }: { mood: MoxMood }) {
  if (mood === "sleep" || mood === "excited") {
    const d = mood === "sleep" ? "Q38 58 43 54" : "Q38 48 43 54";
    const d2 = mood === "sleep" ? "Q62 58 67 54" : "Q62 48 67 54";
    return (
      <g stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none">
        <path d={`M33 54 ${d}`} />
        <path d={`M57 54 ${d2}`} />
      </g>
    );
  }
  const ry = mood === "wow" ? 7.5 : 6.5;
  const rx = mood === "wow" ? 5.6 : 5;
  return (
    <g
      className="mox-eyes"
      style={{ transformOrigin: "50px 54px", animation: "mox-blink 4.6s infinite" }}
    >
      <ellipse cx="38" cy="54" rx={rx} ry={ry} fill={INK} />
      <ellipse cx="62" cy="54" rx={rx} ry={ry} fill={INK} />
      <circle cx="39.6" cy="51" r="1.7" fill="#FFFFFF" />
      <circle cx="63.6" cy="51" r="1.7" fill="#FFFFFF" />
    </g>
  );
}

function Mouth({ mood }: { mood: MoxMood }) {
  const common = { stroke: INK, strokeWidth: 2.6, fill: "none", strokeLinecap: "round" as const };
  switch (mood) {
    case "wow":
      return <ellipse cx="50" cy="72" rx="3.6" ry="4.4" fill={INK} />;
    case "sad":
      return <path d="M43 75 Q50 70 57 75" {...common} />;
    case "thinking":
      return <path d="M45 73 L55 72" {...common} />;
    case "sleep":
      return <path d="M46 73 Q50 75 54 73" {...common} />;
    case "excited":
      return <path d="M41 69 Q50 79 59 69 Z" fill={INK} />;
    default:
      return <path d="M42 70 Q51 77 59 70" {...common} />;
  }
}
