"use client";

// The bottom of the sidebar, Holo style: Mox peeking over a half-circle
// gauge. The balance itself is in the top bar, so this shows what the thing
// you're setting up will cost (the "credits:preview" event, sent by an
// announcing CostChip in Studio): the slice it takes lights up and the
// price is written under Mox. With nothing being set up, the arc just shows
// how full the month's allowance is. A click opens Plan & billing; owners on
// Free also get Upgrade. Mox looks worried when the balance runs low.

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MoxFace } from "@/components/brand/mox/MoxFace";
import { useAppEvent } from "@/hooks/use-app-event";
import { emitAppEvent, type AppEventMap } from "@/lib/app-events";
import { walletView } from "@/lib/billing/present";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { cn } from "@/lib/utils";

const R = 34;
const ARC = Math.PI * R;
const PATH = `M8 42 A${R} ${R} 0 0 1 76 42`;

type Preview = NonNullable<AppEventMap["credits:preview"]>;

export function MoxGauge({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { data } = useEntitlements();
  const reduce = useReducedMotion();
  const [preview, setPreview] = useState<Preview | null>(null);
  useAppEvent("credits:preview", (e) => setPreview(e.detail ?? null));

  const w = data ? walletView(data) : null;
  const fill = w?.fill ?? 0;
  // The share of the allowance this would take (credits only; points and
  // video credits light the whole remaining arc).
  const take =
    preview && w
      ? preview.credits !== undefined && w.points === null && w.allowance > 0
        ? Math.min(fill, preview.credits / w.allowance)
        : fill * 0.25
      : 0;
  const after = Math.max(0, fill - take);
  const short =
    !!preview &&
    !!w &&
    preview.credits !== undefined &&
    w.points === null &&
    preview.credits > w.credits;
  const color = w?.tone === "empty" ? "#E5484D" : w?.tone === "low" ? "#F5A524" : "url(#mox-gauge)";
  const mood =
    short || w?.tone === "empty"
      ? "sad"
      : preview
        ? "wow"
        : w?.tone === "low"
          ? "thinking"
          : "happy";

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <button
        type="button"
        onClick={() => emitAppEvent("open:usage")}
        aria-label={
          preview ? `This will use ${preview.label}. Open Plan & billing` : "Plan & billing"
        }
        className="group relative grid place-items-center rounded-2xl px-2 pt-1 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="relative z-10 -mb-3 transition-transform duration-300 group-hover:-translate-y-1">
          <MoxFace mood={mood} size={compact ? 30 : 42} track />
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
            d={PATH}
            fill="none"
            stroke="currentColor"
            className="text-foreground/[0.08]"
            strokeWidth="7"
            strokeLinecap="round"
          />
          {/* What this would take: the slice past what stays. */}
          {preview && (
            <motion.path
              d={PATH}
              fill="none"
              stroke={short ? "#E5484D" : "#F5A524"}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={ARC}
              animate={{
                strokeDashoffset: ARC * (1 - Math.max(0.02, fill)),
                opacity: reduce ? 1 : [1, 0.45, 1],
              }}
              transition={{
                strokeDashoffset: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
                opacity: { duration: 1.4, repeat: Infinity, ease: "easeInOut" },
              }}
            />
          )}
          <motion.path
            d={PATH}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={ARC}
            initial={{ strokeDashoffset: ARC }}
            animate={{
              strokeDashoffset: ARC * (1 - Math.max(0.02, preview ? after : fill)),
              x: w && w.tone !== "ok" && !reduce ? [0, -2, 2, -1, 0] : 0,
            }}
            transition={{
              strokeDashoffset: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
              x: { duration: 0.5, delay: 1 },
            }}
          />
        </svg>
        {!compact && (
          <span className="-mt-3 flex h-8 flex-col items-center justify-start">
            <AnimatePresence mode="wait" initial={false}>
              {preview ? (
                <motion.span
                  key={preview.label}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="flex flex-col items-center leading-tight"
                >
                  <span
                    className={cn(
                      "text-[12px] font-bold tabular-nums",
                      short ? "text-destructive" : "text-foreground",
                    )}
                  >
                    −{preview.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {short ? "Not enough left" : "if you make this"}
                  </span>
                </motion.span>
              ) : (
                <motion.span
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="pt-0.5 text-[10.5px] font-medium text-muted-foreground"
                >
                  Costs show here
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        )}
      </button>
      {!compact && w?.canUpgrade && (
        <button
          type="button"
          onClick={() => emitAppEvent("open:upgrade")}
          className="ds-grad-pill mt-1 h-7 rounded-full px-3 text-[11.5px]"
        >
          Upgrade
        </button>
      )}
    </div>
  );
}
