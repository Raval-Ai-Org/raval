"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { RATIOS, type AspectRatio } from "@/lib/studio/aspect";
import type { CarouselSlide, MediaOutput } from "@/lib/studio/jobs";
import { RatioFrame } from "../studio-ui";
import { inkOn, type PreviewBrand } from "./brand";

const NAV =
  "absolute top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-surface-3/95 text-foreground shadow-2 ring-1 ring-border/70 backdrop-blur transition-[opacity,transform] duration-[--motion-duration-base] hover:scale-105 disabled:hidden md:opacity-0 md:group-hover/carousel:opacity-100 md:focus-visible:opacity-100";

/**
 * Designed slides — typographic layouts in the brand's colour and typeface,
 * with the generated cover visual behind slide one. Swipe-style transitions,
 * arrow keys, and a filmstrip to jump anywhere.
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
  const reduce = useReducedMotion();
  const [[index, direction], setPage] = useState<[number, number]>([0, 0]);
  const count = slides.length;
  useEffect(() => {
    if (index > count - 1) setPage([Math.max(0, count - 1), -1]);
  }, [count, index]);

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(count - 1, next));
    if (clamped !== index) setPage([clamped, clamped > index ? 1 : -1]);
  };

  const slide = slides[Math.min(index, count - 1)];
  if (!slide) return null;
  const bg = brand.color ?? "hsl(var(--foreground))";
  const ink = brand.color ? inkOn(brand.color) : "hsl(var(--background))";
  const coverImage = cover?.status === "ready" ? cover.url : undefined;
  const meta = RATIOS[ratio];

  return (
    <div
      className="mx-auto w-full max-w-[440px]"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName.match(/INPUT|TEXTAREA/)) return;
        if (e.key === "ArrowRight") go(index + 1);
        if (e.key === "ArrowLeft") go(index - 1);
      }}
    >
      <div className="group/carousel relative">
        <RatioFrame
          ratio={ratio}
          maxHeight={540}
          className={cn(
            "rounded-2xl shadow-3 ring-1",
            editing ? "ring-primary-border" : "ring-border/70",
          )}
        >
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            <motion.div
              key={index}
              custom={direction}
              className="absolute inset-0"
              variants={{
                enter: (d: number) => (reduce ? { opacity: 0 } : { x: `${d * 28}%`, opacity: 0 }),
                center: { x: 0, opacity: 1 },
                exit: (d: number) => (reduce ? { opacity: 0 } : { x: `${d * -28}%`, opacity: 0 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: duration.slow, ease: ease.emphasized }}
            >
              <Slide
                slide={slide}
                index={index}
                count={count}
                brand={brand}
                bg={bg}
                ink={ink}
                coverImage={index === 0 ? coverImage : undefined}
                editing={editing}
                onChange={(s) => onSlideChange?.(index, s)}
              />
            </motion.div>
          </AnimatePresence>
        </RatioFrame>
        <button
          type="button"
          onClick={() => go(index - 1)}
          disabled={index === 0}
          aria-label="Previous slide"
          className={cn(NAV, "-left-4")}
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => go(index + 1)}
          disabled={index === count - 1}
          aria-label="Next slide"
          className={cn(NAV, "-right-4")}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div
        className="mt-4 flex justify-center gap-2 overflow-x-auto px-1 pb-1 pt-1"
        role="tablist"
        aria-label="Slides"
      >
        {slides.map((s, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Slide ${i + 1}: ${s.heading}`}
            onClick={() => go(i)}
            className={cn(
              "relative w-10 shrink-0 overflow-hidden rounded-md transition-[box-shadow,opacity,transform] duration-[--motion-duration-base]",
              i === index
                ? "opacity-100 ring-2 ring-primary ring-offset-2 ring-offset-surface-1"
                : "opacity-55 ring-1 ring-border hover:opacity-90",
            )}
            style={{ aspectRatio: `${meta.w} / ${meta.h}`, background: bg }}
          >
            {i === 0 && coverImage ? (
              <img src={coverImage} alt="" className="absolute inset-0 size-full object-cover" />
            ) : null}
            <span className="absolute inset-x-1.5 bottom-2 space-y-[3px]" aria-hidden>
              <span
                className="block h-[3px] w-full rounded-full opacity-80"
                style={{ background: i === 0 && coverImage ? "#fff" : ink }}
              />
              <span
                className="block h-[3px] w-2/3 rounded-full opacity-60"
                style={{ background: i === 0 && coverImage ? "#fff" : ink }}
              />
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-xs tabular-nums text-muted-foreground">
        Slide {index + 1} of {count} · {meta.label} {ratio}
      </p>
    </div>
  );
}

function Slide({
  slide,
  index,
  count,
  brand,
  bg,
  ink,
  coverImage,
  editing,
  onChange,
}: {
  slide: CarouselSlide;
  index: number;
  count: number;
  brand: PreviewBrand;
  bg: string;
  ink: string;
  coverImage?: string;
  editing?: boolean;
  onChange: (slide: CarouselSlide) => void;
}) {
  const isCover = index === 0;
  const isLast = index === count - 1;
  const color = coverImage ? "#fff" : ink;
  return (
    <div
      className="absolute inset-0 flex flex-col p-[8%]"
      style={{
        background: bg,
        color,
        fontFamily: brand.font ? `"${brand.font}", var(--font-sans, system-ui)` : undefined,
      }}
    >
      {coverImage ? (
        <>
          <img src={coverImage} alt="" className="absolute inset-0 size-full object-cover" />
          <span
            className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent"
            aria-hidden
          />
        </>
      ) : null}
      <div className="relative flex items-center justify-between text-[11px] font-medium opacity-80">
        <span>{brand.name}</span>
        <span className="tabular-nums">
          {index + 1}/{count}
        </span>
      </div>
      <div className={cn("relative mt-auto", !isCover && "mb-auto mt-[18%]")}>
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={slide.heading}
              onChange={(e) => onChange({ ...slide, heading: e.target.value.replace(/\n/g, " ") })}
              aria-label={`Slide ${index + 1} heading`}
              rows={2}
              className="w-full resize-none rounded-lg bg-black/15 px-2.5 py-1.5 text-xl font-semibold leading-tight outline-none ring-1 ring-white/30 focus-visible:ring-2 focus-visible:ring-white/70"
              style={{ color: "inherit" }}
            />
            <textarea
              value={slide.body}
              onChange={(e) => onChange({ ...slide, body: e.target.value })}
              aria-label={`Slide ${index + 1} body`}
              rows={4}
              className="w-full resize-none rounded-lg bg-black/15 px-2.5 py-1.5 text-sm leading-snug outline-none ring-1 ring-white/30 focus-visible:ring-2 focus-visible:ring-white/70"
              style={{ color: "inherit" }}
            />
          </div>
        ) : (
          <>
            <h4
              className={cn(
                "text-balance font-semibold leading-[1.08] tracking-[-0.02em]",
                isCover ? "text-[clamp(1.5rem,5vw,2.15rem)]" : "text-[clamp(1.15rem,4vw,1.6rem)]",
              )}
            >
              {slide.heading}
            </h4>
            {slide.body ? (
              <p className="mt-3 text-pretty text-[clamp(0.82rem,2.6vw,1rem)] leading-snug opacity-90">
                {slide.body}
              </p>
            ) : null}
          </>
        )}
      </div>
      {isLast && !editing ? (
        <div className="relative mt-auto flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] opacity-75">
          <span className="h-px w-6 bg-current" aria-hidden />
          Save this for later
        </div>
      ) : !isLast && !editing ? (
        <div className="relative mt-auto flex justify-end text-[11px] font-medium opacity-70">
          Swipe →
        </div>
      ) : null}
    </div>
  );
}
