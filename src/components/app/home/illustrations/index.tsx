"use client";

// Holo-type "glass" objects for Home's cards (Mellox 2.0, ADR-0044): small SVG
// scenes in Mox's palette with translucent fills, a top highlight and a soft
// glow underneath. Pure SVG, no images; each instance gets its own gradient
// ids. A card that wants them to bob on hover marks them `data-illo`.

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type IlloKind =
  | "post"
  | "video"
  | "article"
  | "carousel"
  | "poster"
  | "story"
  | "ad"
  | "rocket"
  | "swipe"
  | "website"
  | "versions"
  | "animate";

function Glass({
  className,
  children,
}: {
  className?: string;
  children: (ids: {
    lime: string;
    sky: string;
    glass: string;
    glow: string;
    shine: string;
  }) => ReactNode;
}) {
  const raw = useId().replace(/[:]/g, "");
  const ids = {
    lime: `l${raw}`,
    sky: `s${raw}`,
    glass: `g${raw}`,
    glow: `w${raw}`,
    shine: `h${raw}`,
  };
  return (
    <svg
      viewBox="0 0 160 120"
      aria-hidden
      data-illo
      className={cn("pointer-events-none select-none overflow-visible", className)}
    >
      <defs>
        <linearGradient id={ids.lime} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E9FB7A" />
          <stop offset="0.55" stopColor="#7FEA5A" />
          <stop offset="1" stopColor="#21C77A" />
        </linearGradient>
        <linearGradient id={ids.sky} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7DF0E8" />
          <stop offset="0.6" stopColor="#3AB6F4" />
          <stop offset="1" stopColor="#2B6FF0" />
        </linearGradient>
        <linearGradient id={ids.glass} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={ids.shine} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={ids.glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#5BE38A" stopOpacity="0.55" />
          <stop offset="1" stopColor="#5BE38A" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="80" cy="108" rx="58" ry="10" fill={`url(#${ids.glow})`} />
      {children(ids)}
    </svg>
  );
}

const STROKE = { stroke: "#ffffff", strokeOpacity: 0.9, strokeWidth: 1.5 } as const;

export function Illustration({ kind, className }: { kind: IlloKind; className?: string }) {
  return (
    <Glass className={className}>
      {(g) => {
        const lime = `url(#${g.lime})`;
        const sky = `url(#${g.sky})`;
        const glass = `url(#${g.glass})`;
        const shine = `url(#${g.shine})`;
        switch (kind) {
          case "post":
            return (
              <>
                <rect
                  x="38"
                  y="22"
                  width="70"
                  height="78"
                  rx="12"
                  fill={sky}
                  opacity="0.55"
                  transform="rotate(-10 73 61)"
                />
                <rect x="50" y="16" width="70" height="82" rx="12" fill={glass} {...STROKE} />
                <rect x="57" y="23" width="56" height="44" rx="8" fill={lime} />
                <circle cx="85" cy="45" r="11" fill="#ffffff" fillOpacity="0.8" />
                <circle cx="85" cy="45" r="6" fill={sky} />
                <rect x="57" y="74" width="40" height="5" rx="2.5" fill="#16191b" opacity="0.18" />
                <rect x="57" y="84" width="26" height="5" rx="2.5" fill="#16191b" opacity="0.1" />
                <rect x="54" y="18" width="62" height="4" rx="2" fill={shine} />
              </>
            );
          case "video":
            return (
              <>
                <path d="M48 26 L118 60 L48 94 Z" fill={lime} opacity="0.9" />
                <path d="M58 20 L128 54 L58 88 Z" fill={glass} {...STROKE} opacity="0.85" />
                <path d="M74 42 L100 54 L74 66 Z" fill={sky} />
                <path
                  d="M60 24 L110 48"
                  stroke="#fff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity="0.8"
                />
              </>
            );
          case "article":
            return (
              <>
                <path d="M30 70 L128 24 L96 98 L80 76 Z" fill={lime} />
                <path d="M80 76 L128 24 L70 66 Z" fill="#ffffff" opacity="0.7" />
                <path d="M80 76 L84 96 L96 98 Z" fill={sky} />
                <path d="M30 70 L70 66 L80 76 Z" fill="#21C77A" opacity="0.8" />
                <path
                  d="M36 104 q30 -14 52 -10"
                  stroke={sky}
                  strokeWidth="2.5"
                  fill="none"
                  strokeDasharray="3 5"
                  strokeLinecap="round"
                />
              </>
            );
          case "carousel":
            return (
              <>
                <rect
                  x="26"
                  y="30"
                  width="54"
                  height="66"
                  rx="10"
                  fill={sky}
                  opacity="0.6"
                  transform="rotate(-14 53 63)"
                />
                <rect
                  x="80"
                  y="30"
                  width="54"
                  height="66"
                  rx="10"
                  fill={lime}
                  opacity="0.75"
                  transform="rotate(14 107 63)"
                />
                <rect x="52" y="20" width="56" height="76" rx="11" fill={glass} {...STROKE} />
                <rect x="59" y="28" width="42" height="34" rx="7" fill={lime} />
                <circle cx="70" cy="84" r="3" fill="#16191b" opacity="0.5" />
                <circle cx="80" cy="84" r="3" fill="#16191b" opacity="0.2" />
                <circle cx="90" cy="84" r="3" fill="#16191b" opacity="0.2" />
              </>
            );
          case "poster":
            return (
              <>
                <ellipse cx="80" cy="92" rx="44" ry="11" fill={sky} />
                <rect x="36" y="80" width="88" height="12" fill={sky} opacity="0.75" />
                <ellipse cx="80" cy="80" rx="44" ry="11" fill={glass} {...STROKE} />
                <rect x="64" y="30" width="32" height="48" rx="9" fill={lime} />
                <rect x="70" y="22" width="20" height="12" rx="4" fill="#21C77A" />
                <rect x="68" y="38" width="6" height="30" rx="3" fill="#ffffff" opacity="0.7" />
                <path d="M118 30 l4 8 8 4 -8 4 -4 8 -4 -8 -8 -4 8 -4z" fill={sky} />
              </>
            );
          case "story":
            return (
              <>
                <rect x="54" y="10" width="52" height="94" rx="14" fill={glass} {...STROKE} />
                <rect x="60" y="18" width="40" height="78" rx="9" fill={sky} />
                <rect x="64" y="22" width="32" height="3" rx="1.5" fill="#ffffff" opacity="0.9" />
                <circle cx="80" cy="56" r="13" fill={lime} />
                <rect x="58" y="12" width="44" height="4" rx="2" fill={shine} />
              </>
            );
          case "ad":
            return (
              <>
                <path d="M40 54 L96 30 L96 90 L40 70 Z" fill={lime} />
                <rect x="28" y="52" width="16" height="20" rx="5" fill={sky} />
                <rect x="96" y="26" width="12" height="68" rx="6" fill={glass} {...STROKE} />
                <path
                  d="M118 44 q10 16 0 32"
                  stroke={sky}
                  strokeWidth="4"
                  fill="none"
                  strokeLinecap="round"
                />
                <path
                  d="M126 36 q16 24 0 48"
                  stroke={sky}
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                  opacity="0.6"
                />
              </>
            );
          case "rocket":
            return (
              <>
                <path
                  d="M80 12 C100 30 102 62 94 84 L66 84 C58 62 60 30 80 12 Z"
                  fill={glass}
                  {...STROKE}
                />
                <circle cx="80" cy="46" r="10" fill={sky} />
                <path d="M66 70 L50 90 L66 86 Z" fill={lime} />
                <path d="M94 70 L110 90 L94 86 Z" fill={lime} />
                <path d="M70 86 Q80 112 90 86 Z" fill="#F2F23A" />
                <path d="M74 86 Q80 102 86 86 Z" fill="#ffffff" opacity="0.8" />
              </>
            );
          case "swipe":
            return (
              <>
                <rect
                  x="40"
                  y="26"
                  width="58"
                  height="74"
                  rx="12"
                  fill={sky}
                  opacity="0.55"
                  transform="rotate(-12 69 63)"
                />
                <rect
                  x="62"
                  y="18"
                  width="60"
                  height="78"
                  rx="12"
                  fill={glass}
                  {...STROKE}
                  transform="rotate(8 92 57)"
                />
                <g transform="rotate(8 92 57)">
                  <rect x="70" y="28" width="44" height="30" rx="7" fill={lime} />
                  <rect
                    x="70"
                    y="64"
                    width="34"
                    height="5"
                    rx="2.5"
                    fill="#16191b"
                    opacity="0.18"
                  />
                  <circle cx="108" cy="84" r="9" fill="#21C77A" />
                  <path
                    d="M104 84 l3 3 6 -6"
                    stroke="#fff"
                    strokeWidth="2.4"
                    fill="none"
                    strokeLinecap="round"
                  />
                </g>
              </>
            );
          case "website":
            return (
              <>
                <rect x="26" y="22" width="108" height="74" rx="12" fill={glass} {...STROKE} />
                <rect x="26" y="22" width="108" height="16" rx="12" fill={sky} />
                <circle cx="37" cy="30" r="2.6" fill="#fff" />
                <circle cx="45" cy="30" r="2.6" fill="#fff" opacity="0.7" />
                <rect x="36" y="46" width="44" height="40" rx="7" fill={lime} />
                <rect x="88" y="48" width="36" height="5" rx="2.5" fill="#16191b" opacity="0.2" />
                <rect x="88" y="58" width="28" height="5" rx="2.5" fill="#16191b" opacity="0.12" />
                <rect x="88" y="72" width="30" height="12" rx="6" fill="#21C77A" />
              </>
            );
          case "versions":
            return (
              <>
                <rect x="30" y="24" width="48" height="70" rx="10" fill={lime} />
                <rect x="82" y="24" width="48" height="70" rx="10" fill={sky} />
                <rect x="74" y="16" width="12" height="86" rx="6" fill={glass} {...STROKE} />
                <circle cx="80" cy="59" r="9" fill="#ffffff" />
                <path
                  d="M76 59 h8 M78 56 l-3 3 3 3 M82 56 l3 3 -3 3"
                  stroke="#16191b"
                  strokeWidth="1.6"
                  fill="none"
                  strokeLinecap="round"
                />
              </>
            );
          case "animate":
            return (
              <>
                <rect
                  x="22"
                  y="34"
                  width="116"
                  height="50"
                  rx="10"
                  fill={glass}
                  {...STROKE}
                  transform="rotate(-6 80 59)"
                />
                <g transform="rotate(-6 80 59)">
                  {[0, 1, 2].map((i) => (
                    <rect
                      key={i}
                      x={32 + i * 34}
                      y="42"
                      width="28"
                      height="34"
                      rx="6"
                      fill={i === 1 ? lime : sky}
                      opacity={i === 1 ? 1 : 0.7}
                    />
                  ))}
                  {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <rect
                      key={i}
                      x={28 + i * 16}
                      y="36"
                      width="7"
                      height="3"
                      rx="1.5"
                      fill="#16191b"
                      opacity="0.25"
                    />
                  ))}
                </g>
              </>
            );
        }
      }}
    </Glass>
  );
}
