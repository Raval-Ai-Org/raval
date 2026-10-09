"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from "framer-motion";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { ensureGoogleFonts } from "@/lib/brand-look/fonts";
import { RATIOS, type AspectRatio } from "@/lib/studio/aspect";
import { SlideArt, type SlideArtProps } from "@/lib/studio/carousel/SlideArt";
import {
  carouselTheme,
  isSeamless,
  pickCarouselDesign,
  safeDesign,
  safeTheme,
} from "@/lib/studio/carousel/design";
import { withRoles } from "@/lib/studio/carousel/story";
import type { CarouselSlide, CarouselSpecOutput, MediaOutput } from "@/lib/studio/jobs";
import { RatioFrame } from "../studio-ui";
import type { PreviewBrand } from "./brand";

const NAV =
  "absolute top-1/2 z-10 grid size-9 -translate-y-1/2 place-items-center rounded-full bg-surface-3/95 text-foreground shadow-2 ring-1 ring-border/70 backdrop-blur transition-[opacity,transform] duration-[--motion-duration-base] hover:scale-105 disabled:hidden md:opacity-0 md:group-hover/carousel:opacity-100 md:focus-visible:opacity-100";

const FIELD =
  "w-full resize-none rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm leading-snug text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

/** Rendered width of an element, kept current as the layout changes. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * A connected carousel on one endless track: the slides sit edge to edge with
 * no gap, and the track is drawn around wherever it currently is, so it can be
 * dragged or stepped in either direction for ever without a jump.
 */
function SeamlessTrack({
  page,
  onPage,
  width,
  height,
  art,
}: {
  /** Which slide is in view. Not wrapped: page 7 of a 5-slide carousel is slide 3. */
  page: number;
  onPage: (page: number) => void;
  width: number;
  height: number;
  art: Omit<SlideArtProps, "index" | "width" | "height">;
}) {
  const reduce = useReducedMotion();
  const count = art.slides.length;
  const x = useMotionValue(-page * width);
  // The slide nearest the middle of the frame right now, mid-drag included.
  const [near, setNear] = useState(page);
  useMotionValueEvent(x, "change", (value) => {
    const next = Math.round(-value / width);
    if (Number.isFinite(next)) setNear(next);
  });
  const sized = useRef(width);
  useEffect(() => {
    const target = -page * width;
    if (reduce || sized.current !== width) {
      sized.current = width;
      x.set(target);
      return;
    }
    const controls = animate(x, target, { duration: duration.slow, ease: ease.emphasized });
    return () => controls.stop();
  }, [page, width, reduce, x]);

  return (
    <motion.div
      className="absolute inset-0 cursor-grab touch-pan-y active:cursor-grabbing"
      style={{ x }}
      drag="x"
      dragMomentum={false}
      onDragEnd={(_, info) => {
        const flick = Math.abs(info.velocity.x) > 300 ? -Math.sign(info.velocity.x) : 0;
        const dragged = Math.round(-x.get() / width);
        const next = dragged === page ? page + flick : dragged;
        if (next === page) animate(x, -page * width, { duration: duration.base });
        else onPage(next);
      }}
    >
      {[-2, -1, 0, 1, 2].map((offset) => {
        const at = near + offset;
        return (
          <div
            key={at}
            aria-hidden={at !== page}
            className="absolute top-0"
            style={{ left: at * width, width, height }}
          >
            <SlideArt {...art} index={mod(at, count)} width={width} height={height} />
          </div>
        );
      })}
    </motion.div>
  );
}

/**
 * The carousel as it will be published: the slides are drawn by the same
 * SlideArt the server turns into images. Arrow keys, swipe-style transitions
 * and a filmstrip of real thumbnails.
 */
export function CarouselPreview({
  slides: rawSlides,
  brand,
  ratio = "4:5",
  cover,
  generatedSlides,
  spec,
  editing,
  onSlideChange,
}: {
  slides: CarouselSlide[];
  brand: PreviewBrand;
  ratio?: AspectRatio;
  cover?: MediaOutput | null;
  generatedSlides?: MediaOutput[];
  /** The look chosen for this carousel; older carousels fall back to the brand's. */
  spec?: CarouselSpecOutput | null;
  editing?: boolean;
  onSlideChange?: (index: number, slide: CarouselSlide) => void;
}) {
  const reduce = useReducedMotion();
  const [[index, direction], setPage] = useState<[number, number]>([0, 0]);
  const slides = useMemo(() => withRoles(rawSlides), [rawSlides]);
  const count = slides.length;
  // A connected carousel loops, so its page number is never clamped.
  const seamless = isSeamless(safeDesign(spec?.design)) && !generatedSlides?.length;
  useEffect(() => {
    if (!seamless && (index > count - 1 || index < 0))
      setPage([Math.max(0, Math.min(count - 1, index)), -1]);
  }, [count, index, seamless]);

  const look = useMemo(() => {
    const design = safeDesign(spec?.design);
    const theme = safeTheme(spec?.theme);
    if (design && theme) return { design, theme };
    const palette = { primary: brand.color };
    const fallback = pickCarouselDesign({ profileKey: brand.name, seed: brand.name, palette });
    return {
      design: fallback,
      theme: carouselTheme({
        palette,
        fonts: { heading: brand.font },
        colorway: fallback.colorway,
      }),
    };
  }, [spec, brand.color, brand.font, brand.name]);

  useEffect(() => {
    ensureGoogleFonts([look.theme.headingFont, look.theme.bodyFont]);
  }, [look.theme.headingFont, look.theme.bodyFont]);

  const [frameRef, width] = useWidth<HTMLDivElement>();
  const meta = RATIOS[ratio];
  const height = (width * meta.h) / meta.w;

  const go = (next: number) => {
    const clamped = seamless ? next : Math.max(0, Math.min(count - 1, next));
    if (clamped !== index) setPage([clamped, clamped > index ? 1 : -1]);
  };
  /** Go to slide `i` the short way round. */
  const goToSlide = (i: number) => {
    if (!seamless) return go(i);
    const ahead = mod(i - index, count);
    go(index + (ahead <= count / 2 ? ahead : ahead - count));
  };

  const current = seamless ? mod(index, count || 1) : Math.max(0, Math.min(index, count - 1));
  const slide = slides[current];
  if (!slide) return null;
  const coverImage = cover?.status === "ready" ? cover.url : undefined;
  const art = {
    slides,
    design: look.design,
    theme: look.theme,
    brand: spec?.brand || brand.name,
    site: spec?.site,
    coverImage,
  };
  const thumbWidth = 44;

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
          <div ref={frameRef} className="absolute inset-0">
            {seamless ? (
              width > 0 ? (
                <SeamlessTrack page={index} onPage={go} width={width} height={height} art={art} />
              ) : null
            ) : (
              <AnimatePresence initial={false} custom={direction} mode="popLayout">
                <motion.div
                  key={current}
                  custom={direction}
                  className="absolute inset-0"
                  variants={{
                    enter: (d: number) =>
                      reduce ? { opacity: 0 } : { x: `${d * 28}%`, opacity: 0 },
                    center: { x: 0, opacity: 1 },
                    exit: (d: number) =>
                      reduce ? { opacity: 0 } : { x: `${d * -28}%`, opacity: 0 },
                  }}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: duration.slow, ease: ease.emphasized }}
                >
                  {generatedSlides?.length ? (
                    generatedSlides[current]?.status === "ready" &&
                    generatedSlides[current]?.url ? (
                      <img
                        src={generatedSlides[current].url}
                        alt={`Slide ${current + 1}: ${slide.heading}`}
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="grid size-full place-items-center bg-surface-2 px-8 text-center text-sm text-muted-foreground">
                        {generatedSlides[current]?.status === "failed"
                          ? "This slide needs another render."
                          : "Creating slide artwork…"}
                      </div>
                    )
                  ) : width > 0 ? (
                    <SlideArt {...art} index={current} width={width} height={height} />
                  ) : null}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
        </RatioFrame>
        <button
          type="button"
          onClick={() => go(index - 1)}
          disabled={!seamless && index === 0}
          aria-label="Previous slide"
          className={cn(NAV, "-left-4")}
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => go(index + 1)}
          disabled={!seamless && index === count - 1}
          aria-label="Next slide"
          className={cn(NAV, "-right-4")}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {editing ? (
        <div className="mt-4 space-y-2">
          {current > 0 && current < count - 1 ? (
            <input
              value={slide.kicker ?? ""}
              onChange={(e) =>
                onSlideChange?.(current, { ...slide, kicker: e.target.value.slice(0, 26) })
              }
              aria-label={`Slide ${current + 1} label`}
              placeholder="Label (optional)"
              className={FIELD}
            />
          ) : null}
          <textarea
            value={slide.heading}
            onChange={(e) =>
              onSlideChange?.(current, {
                ...slide,
                heading: e.target.value.replace(/\n/g, " ").slice(0, 90),
                emphasis: undefined,
              })
            }
            aria-label={`Slide ${current + 1} heading`}
            rows={2}
            className={cn(FIELD, "font-semibold")}
          />
          <textarea
            value={slide.body}
            onChange={(e) =>
              onSlideChange?.(current, { ...slide, body: e.target.value.slice(0, 320) })
            }
            aria-label={`Slide ${current + 1} text`}
            rows={slide.role === "recap" ? 4 : 3}
            className={FIELD}
          />
        </div>
      ) : null}

      <div
        // Connected slides are shown touching, so the whole picture can be seen.
        className={cn(
          "mt-4 flex justify-center overflow-x-auto px-1 pb-1 pt-1",
          seamless ? "gap-0" : "gap-2",
        )}
        role="tablist"
        aria-label="Slides"
      >
        {slides.map((s, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === current}
            aria-label={`Slide ${i + 1}: ${s.heading}`}
            onClick={() => goToSlide(i)}
            className={cn(
              "relative shrink-0 overflow-hidden transition-[box-shadow,opacity,transform] duration-[--motion-duration-base]",
              seamless
                ? cn(
                    i === 0 && "rounded-l-md",
                    i === count - 1 && "rounded-r-md",
                    i === current
                      ? "z-10 opacity-100 ring-2 ring-primary"
                      : "opacity-60 hover:opacity-90",
                  )
                : cn(
                    "rounded-md",
                    i === current
                      ? "opacity-100 ring-2 ring-primary ring-offset-2 ring-offset-surface-1"
                      : "opacity-60 ring-1 ring-border hover:opacity-90",
                  ),
            )}
            style={{ width: thumbWidth, height: (thumbWidth * meta.h) / meta.w }}
          >
            <span aria-hidden className="pointer-events-none absolute inset-0">
              {generatedSlides?.[i]?.url ? (
                <img src={generatedSlides[i].url} alt="" className="size-full object-cover" />
              ) : generatedSlides?.length ? (
                <span className="block size-full bg-surface-2" />
              ) : (
                <SlideArt
                  {...art}
                  index={i}
                  width={thumbWidth}
                  height={(thumbWidth * meta.h) / meta.w}
                />
              )}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-xs tabular-nums text-muted-foreground">
        Slide {current + 1} of {count} · {meta.label} {ratio}
        {seamless ? " · Connected, loops" : ""}
      </p>
    </div>
  );
}
