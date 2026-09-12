"use client";

import { useState } from "react";
import { MoreHorizontal } from "@/components/icons";
import { cn } from "@/lib/utils";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import type { AspectRatio } from "@/lib/studio/aspect";
import type { AdVariant, MediaOutput } from "@/lib/studio/jobs";
import { BrandAvatar, type PreviewBrand } from "./brand";
import { MediaFrame } from "./MediaFrame";

/** Feed-ad rendering with A/B/C variants to compare side by side. */
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
  const ad = ads[Math.min(active, ads.length - 1)];
  if (!ad) return null;
  const spec = PLATFORMS[platform];
  const letters = ["A", "B", "C", "D"];

  return (
    <div className="mx-auto w-full max-w-[500px]">
      <div role="tablist" aria-label="Ad variants" className="mb-3 flex flex-wrap gap-1.5">
        {ads.map((v, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium",
              i === active
                ? "border-primary-border bg-primary-surface text-foreground"
                : "border-border bg-surface-3 text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="font-semibold">{letters[i]}</span>
            {v.label ? <span className="max-w-[120px] truncate">{v.label}</span> : null}
          </button>
        ))}
      </div>

      <article className="overflow-hidden rounded-2xl border border-border bg-surface-3 shadow-1">
        <header className="flex items-center gap-2.5 px-4 pb-2 pt-3.5">
          <BrandAvatar brand={brand} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{brand.name}</p>
            <p className="text-xs text-muted-foreground">Sponsored · {spec.label}</p>
          </div>
          <MoreHorizontal className="size-4 text-muted-foreground" aria-hidden />
        </header>
        <p className="whitespace-pre-wrap px-4 pb-3 text-sm leading-relaxed text-foreground">
          {ad.primaryText}
        </p>
        <MediaFrame
          media={media}
          ratio={media?.ratio ?? ratio}
          alt={ad.headline}
          rounded={false}
          onRetry={onRetryMedia}
          onExpand={onExpand}
          maxHeight={500}
        />
        <footer className="flex items-center gap-3 bg-surface-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{ad.headline}</p>
            {ad.description ? (
              <p className="truncate text-xs text-muted-foreground">{ad.description}</p>
            ) : null}
          </div>
          <span className="shrink-0 rounded-md bg-surface-3 px-3 py-1.5 text-xs font-semibold text-foreground ring-1 ring-border">
            {ad.cta}
          </span>
        </footer>
      </article>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Primary text {ad.primaryText.length} chars · headline {ad.headline.length} chars
      </p>
    </div>
  );
}
