"use client";

// The bottom of the sidebar, Holo style: Mox peeking over a half-circle
// gauge of the credits left this month. Same numbers as the top-bar pill
// (walletView). A click opens Plan & billing; owners on Free also get
// Upgrade. Mox looks worried when the balance runs low and the needle
// shakes once.

import { motion, useReducedMotion } from "framer-motion";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import { emitAppEvent } from "@/lib/app-events";
import { formatNumber, walletView } from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { cn } from "@/lib/utils";

const R = 34;
const ARC = Math.PI * R;

export function MoxGauge({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { data } = useEntitlements();
  const reduce = useReducedMotion();
  const w = data ? walletView(data) : null;
  const fill = w?.fill ?? 0;
  const shown = w ? (w.points ?? w.credits) : null;
  const color = w?.tone === "empty" ? "#E5484D" : w?.tone === "low" ? "#F5A524" : "url(#mox-gauge)";
  const mood = w?.tone === "empty" ? "sad" : w?.tone === "low" ? "thinking" : "happy";

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <button
        type="button"
        onClick={() => emitAppEvent("open:usage")}
        aria-label={
          w
            ? `${formatNumber(shown ?? 0)} ${w.points === null ? "credits" : "points"} left. Open Plan & billing`
            : "Plan & billing"
        }
        className="group relative grid place-items-center rounded-2xl px-2 pt-1 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="relative z-10 -mb-3 transition-transform duration-300 group-hover:-translate-y-1">
          <MoxFace mood={mood} size={compact ? 30 : 44} track />
        </span>
        <svg
          viewBox="0 0 84 46"
          width={compact ? 56 : 84}
          height={compact ? 31 : 46}
          aria-hidden
          className="overflow-visible"
        >
          <defs>
            <linearGradient id="mox-gauge" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#D9F53A" />
              <stop offset="0.5" stopColor="#2EE66B" />
              <stop offset="1" stopColor="#19D6C8" />
            </linearGradient>
          </defs>
          <path
            d={`M8 42 A${R} ${R} 0 0 1 76 42`}
            fill="none"
            stroke="currentColor"
            className="text-foreground/[0.08]"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <motion.path
            d={`M8 42 A${R} ${R} 0 0 1 76 42`}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={ARC}
            initial={{ strokeDashoffset: ARC }}
            animate={{
              strokeDashoffset: ARC * (1 - Math.max(0.02, fill)),
              x: w && w.tone !== "ok" && !reduce ? [0, -2, 2, -1, 0] : 0,
            }}
            transition={{
              strokeDashoffset: { duration: 1.1, ease: [0.16, 1, 0.3, 1] },
              x: { duration: 0.5, delay: 1 },
            }}
          />
        </svg>
        {!compact && (
          <span className="-mt-3.5 text-[12px] font-bold tabular-nums text-foreground">
            {shown === null ? "…" : formatNumber(shown)}
          </span>
        )}
      </button>
      {!compact && w?.canUpgrade && (
        <button
          type="button"
          onClick={() => emitAppEvent("open:upgrade")}
          className="ds-grad-pill mt-1.5 h-7 rounded-full px-3 text-[11.5px]"
        >
          Upgrade
        </button>
      )}
    </div>
  );
}
