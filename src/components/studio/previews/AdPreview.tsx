"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Globe, MoreHorizontal } from "@/components/icons";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import type { AspectRatio } from "@/lib/studio/aspect";
import type { AdVariant, MediaOutput } from "@/lib/studio/jobs";
import { BrandAvatar, type PreviewBrand } from "./brand";
import { MediaFrame } from "./MediaFrame";

const LETTERS = ["A", "B", "C", "D"];

/** Feed-ad rendering with the A/B/C test variants one tap apart. */
export function AdPreview({
  ads,
  platform,
  brand,
  media,
  ratio,
  onRetryMedia,
  onExpand,
}: {
  ads: AdVariant[];
  platform: PlatformId;
  brand: PreviewBrand;
  media?: MediaOutput | null;
  ratio: AspectRatio;
  onRetryMedia?: () => void;
  onExpand?: () => void;
}) {
  const [active, setActive] = useState(0);
  const index = Math.min(active, ads.length - 1);
  const ad = ads[index];
  if (!ad) return null;
  const spec = PLATFORMS[platform];

  return (
    <div className="mx-auto w-full max-w-[500px]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Ad variants"
          className="inline-flex rounded-full bg-surface-3 p-1 shadow-1 ring-1 ring-border/70"
        >
          {ads.map((v, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => setActive(i)}
              className={cn(
                "relative inline-flex h-8 items-center gap-2 rounded-full pl-1.5 pr-3 text-xs font-medium transition-colors duration-[--motion-duration-base]",
                i === index ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {i === index ? (
                <motion.span
                  layoutId="ad-variant"
                  className="absolute inset-0 rounded-full bg-surface-2"
                  transition={{ duration: duration.medium, ease: ease.emphasized }}
                />
              ) : null}
              <span
                className={cn(
                  "relative grid size-5 place-items-center rounded-full text-[10px] font-semibold",
                  i === index ? "bg-primary text-primary-foreground" : "bg-foreground/10",
                )}
              >
                {LETTERS[i]}
              </span>
              <span className="relative max-w-[96px] truncate">
                {v.label || `Variant ${LETTERS[i]}`}
              </span>
            </button>
          ))}
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {ads.length} variants to test
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl bg-surface-3 shadow-3 ring-1 ring-border/70">
        <header className="flex items-center gap-2.5 px-4 pb-2.5 pt-3.5">
          <BrandAvatar brand={brand} size={40} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold text-foreground">{brand.name}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              Sponsored · <Globe className="size-3" />
            </p>
          </div>
          <MoreHorizontal className="size-4 text-muted-foreground" aria-hidden />
        </header>
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={`p-${index}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.base }}
            className="whitespace-pre-wrap px-4 pb-3 text-sm leading-relaxed text-foreground"
          >
            {ad.primaryText}
          </motion.p>
        </AnimatePresence>
        <MediaFrame
          media={media}
          ratio={media?.ratio ?? ratio}
          alt={ad.headline}
          rounded={false}
          onRetry={onRetryMedia}
          onExpand={onExpand}
          maxHeight={520}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.footer
            key={`f-${index}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.base }}
            className="flex items-center gap-3 bg-surface-2/70 px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                {brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "") || "yourbrand"}.com
              </p>
              <p className="truncate text-sm font-semibold text-foreground">{ad.headline}</p>
              {ad.description ? (
                <p className="truncate text-xs text-muted-foreground">{ad.description}</p>
              ) : null}
            </div>
            <span className="shrink-0 rounded-md bg-surface-3 px-3.5 py-2 text-xs font-semibold text-foreground ring-1 ring-border">
              {ad.cta}
            </span>
          </motion.footer>
        </AnimatePresence>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-xs tabular-nums text-muted-foreground">
        <span>{spec.label} feed placement</span>
        <span>
          Primary text {ad.primaryText.length}
          <span aria-hidden> · </span>
          <span className={ad.headline.length > 40 ? "font-medium text-warning" : undefined}>
            Headline {ad.headline.length}/40
          </span>
        </span>
      </div>
    </div>
  );
}
