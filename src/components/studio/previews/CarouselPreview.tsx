"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { AspectRatio } from "@/lib/studio/aspect";
import type { CarouselSlide, MediaOutput } from "@/lib/studio/jobs";
import { RatioFrame } from "../studio-ui";
import { inkOn, type PreviewBrand } from "./brand";

/**
 * Designed slides — typographic layouts in the brand's colour and typeface,
 * with the generated cover visual behind slide one when there is one.
 */
export function CarouselPreview({
  slides,
  brand,
  ratio = "4:5",
  cover,
  editing,
  onSlideChange,
}: {
  slides: CarouselSlide[];
  brand: PreviewBrand;
  ratio?: AspectRatio;
  cover?: MediaOutput | null;
  editing?: boolean;
  onSlideChange?: (index: number, slide: CarouselSlide) => void;
}) {
  const [index, setIndex] = useState(0);
  const count = slides.length;
  const slide = slides[Math.min(index, count - 1)];
  useEffect(() => {
    if (index > count - 1) setIndex(Math.max(0, count - 1));
  }, [count, index]);

  if (!slide) return null;
  const bg = brand.color ?? "hsl(var(--foreground))";
  const ink = brand.color ? inkOn(brand.color) : "hsl(var(--background))";
  const isCover = index === 0;
  const isLast = index === count - 1;
  const coverImage = isCover && cover?.status === "ready" ? cover.url : undefined;

  return (
    <div
      className="mx-auto w-full max-w-[460px]"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") setIndex((i) => Math.min(count - 1, i + 1));
        if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      }}
    >
      <RatioFrame ratio={ratio} maxHeight={520} className="rounded-xl shadow-2 ring-1 ring-border">
        <div
          className="absolute inset-0 flex flex-col p-[8%]"
          style={{
            background: bg,
            color: ink,
            fontFamily: brand.font ? `"${brand.font}", var(--font-sans, system-ui)` : undefined,
          }}
        >
          {coverImage ? (
            <>
              <img src={coverImage} alt="" className="absolute inset-0 size-full object-cover" />
              <span
                className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
                aria-hidden
              />
            </>
          ) : null}
          <div
            className="relative flex items-center justify-between text-[11px] font-medium opacity-80"
            style={coverImage ? { color: "#fff" } : undefined}
          >
            <span>{brand.name}</span>
            <span className="tabular-nums">
              {index + 1}/{count}
            </span>
          </div>
          <div
            className={cn("relative mt-auto", !isCover && "mb-auto mt-[18%]")}
            style={coverImage ? { color: "#fff" } : undefined}
          >
            {editing ? (
              <div className="space-y-2">
                <input
                  value={slide.heading}
                  onChange={(e) => onSlideChange?.(index, { ...slide, heading: e.target.value })}
                  aria-label={`Slide ${index + 1} heading`}
                  className="w-full rounded-md bg-black/15 px-2 py-1 text-xl font-semibold leading-tight outline-none ring-1 ring-white/25 placeholder:text-current/50"
                  style={{ color: "inherit" }}
                />
                <textarea
                  value={slide.body}
                  onChange={(e) => onSlideChange?.(index, { ...slide, body: e.target.value })}
                  aria-label={`Slide ${index + 1} body`}
                  rows={4}
                  className="w-full resize-none rounded-md bg-black/15 px-2 py-1 text-sm leading-snug outline-none ring-1 ring-white/25"
                  style={{ color: "inherit" }}
                />
              </div>
            ) : (
              <>
                <h4
                  className={cn(
                    "font-semibold leading-[1.1] tracking-tight",
                    isCover ? "text-[clamp(1.4rem,5vw,2rem)]" : "text-[clamp(1.1rem,4vw,1.5rem)]",
                  )}
                >
                  {slide.heading}
                </h4>
                {slide.body ? (
                  <p className="mt-3 text-[clamp(0.8rem,2.6vw,0.95rem)] leading-snug opacity-90">
                    {slide.body}
                  </p>
                ) : null}
              </>
            )}
          </div>
          {isLast && !editing ? (
            <div className="relative mt-auto text-[11px] font-medium uppercase tracking-wide opacity-70">
              Save this for later
            </div>
          ) : null}
        </div>
      </RatioFrame>

      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          aria-label="Previous slide"
          className="grid size-8 place-items-center rounded-full border border-border bg-surface-3 text-foreground disabled:opacity-40"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Slides">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Slide ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-5 bg-primary" : "w-1.5 bg-border-strong",
              )}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => setIndex((i) => Math.min(count - 1, i + 1))}
          disabled={index === count - 1}
          aria-label="Next slide"
          className="grid size-8 place-items-center rounded-full border border-border bg-surface-3 text-foreground disabled:opacity-40"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}
