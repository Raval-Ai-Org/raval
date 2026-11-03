"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, RefreshCw } from "@/components/icons";
import type { Discoveries } from "@/lib/brand-extract-events";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { SCAN_PHASES } from "./phases";
import type { ScanProgress, ScanStatus } from "./ScanStage";
import { BrandMark } from "./ui";
import { hostOf } from "./url";
import { foundLine } from "@/lib/products/catalog";

/**
 * The scan, small: it keeps running while the person answers the goal
 * questions, so waiting turns into setting up. Real progress only.
 */
export function ScanStrip({
  url,
  status,
  progress,
  phase,
  discoveries,
  reduce,
  onRetry,
}: {
  url: string;
  status: ScanStatus;
  progress: ScanProgress;
  phase: number;
  discoveries: Discoveries;
  reduce: boolean;
  onRetry: () => void;
}) {
  const host = hostOf(url);
  const site = discoveries.site;
  const name = site?.siteName || host;
  const failed = status === "error";
  const done = status === "ok";
  const pct = done ? 100 : Math.round(Math.min(100, Math.max(0, progress.pct)));
  const items = discoveries.products?.products ?? [];
  const found = items.length ? ` · ${foundLine(items)} found` : "";
  const label = failed
    ? "The scan didn't finish"
    : done
      ? `Brand DNA ready${found}`
      : `${SCAN_PHASES[Math.min(Math.max(phase, 0), SCAN_PHASES.length - 1)].label}${found}`;
  const thumbs = items.filter((p) => p.images[0]).slice(0, 4);

  return (
    <div role="status" aria-live="polite" className="ds-tile flex items-center gap-3 px-3.5 py-3">
      <BrandMark sources={[site?.logoUrl, site?.faviconUrl]} name={name} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-[13px] font-medium">
            <span className="text-muted-foreground">{host}</span>
            <span className="mx-1.5 text-muted-foreground/60">·</span>
            {label}
          </p>
          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
            {failed ? "" : `${pct}%`}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--ds-well-bg)]">
          <motion.div
            className={cn("h-full rounded-full", failed ? "bg-destructive/60" : "bg-primary")}
            initial={false}
            animate={{ width: `${failed ? 100 : pct}%` }}
            transition={{ duration: reduce ? 0 : duration.slow, ease: ease.standard }}
          />
        </div>
      </div>
      {thumbs.length > 0 && !failed && (
        <ul aria-hidden className="hidden shrink-0 -space-x-2.5 min-[420px]:flex">
          <AnimatePresence initial={false}>
            {thumbs.map((p, i) => (
              <motion.li
                key={p.fingerprint}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6, x: 8 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                transition={{
                  type: reduce ? "tween" : "spring",
                  stiffness: 380,
                  damping: 24,
                  delay: reduce ? 0 : i * 0.06,
                }}
                className="h-8 w-8 overflow-hidden rounded-full border-2 border-card bg-[var(--ds-well-bg)] shadow-sm"
              >
                <img
                  src={p.images[0]}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      {done ? (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-4 w-4" aria-hidden />
        </span>
      ) : failed ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/70 px-3 text-[12.5px] font-medium hover:bg-secondary"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
        </button>
      ) : null}
    </div>
  );
}
