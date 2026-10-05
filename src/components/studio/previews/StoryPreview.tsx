"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Eye, EyeOff, Pause, Play, Send } from "@/components/icons";
import { cn } from "@/lib/utils";
import { ensureGoogleFonts } from "@/lib/brand-look/fonts";
import {
  carouselTheme,
  pickCarouselDesign,
  safeDesign,
  safeTheme,
} from "@/lib/studio/carousel/design";
import type { CarouselSpecOutput, MediaOutput } from "@/lib/studio/jobs";
import { StoryArt } from "@/lib/stories/StoryArt";
import { IMAGE_FRAME_SECONDS, type StoryFrame } from "@/lib/stories/frames";
import { STORY_SAFE_ZONE } from "@/lib/stories/placement";
import type { PreviewBrand } from "./brand";

const FIELD =
  "w-full resize-none rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm leading-snug text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

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

/**
 * The Story as people will see it on a phone: the frames are drawn by the same
 * StoryArt the server turns into images, with the app's progress bar and reply
 * bar laid over the top so the safe zones are obvious. Tap the left or right
 * half to move, like the real thing. A video Story plays its video.
 */
export function StoryPreview({
  frames,
  brand,
  spec,
  background,
  generatedFrames,
  video,
  editing,
  onFrameChange,
}: {
  frames: StoryFrame[];
  brand: PreviewBrand;
  spec?: CarouselSpecOutput | null;
  /** The generated photo behind the first frame, if any. */
  background?: MediaOutput | null;
  generatedFrames?: MediaOutput[];
  /** A video Story's video, if this is one. */
  video?: MediaOutput | null;
  editing?: boolean;
  onFrameChange?: (index: number, frame: StoryFrame) => void;
}) {
  const reduce = useReducedMotion();
  const isVideo = !!video;
  const count = isVideo ? 1 : frames.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(!!editing || !!reduce);
  const [progress, setProgress] = useState(0);
  const [showZones, setShowZones] = useState(false);
  const [frameRef, width] = useWidth<HTMLDivElement>();
  const height = (width * 16) / 9;

  useEffect(() => {
    if (index > count - 1) setIndex(Math.max(0, count - 1));
  }, [count, index]);
  useEffect(() => {
    if (editing) setPaused(true);
  }, [editing]);

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

  // Image frames advance every five seconds, as they do in the apps.
  useEffect(() => {
    if (paused || isVideo || count < 1) return;
    setProgress(0);
    const started = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = (t - started) / (IMAGE_FRAME_SECONDS * 1000);
      if (p >= 1) {
        setIndex((i) => (i + 1) % count);
        return;
      }
      setProgress(p);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index, paused, isVideo, count]);

  const current = Math.min(index, Math.max(0, count - 1));
  const frame = frames[current];
  const photo = background?.status === "ready" ? background.url : null;
  const videoUrl = video?.status === "ready" ? video.url : null;
  const go = (next: number) => {
    setIndex(Math.max(0, Math.min(count - 1, next)));
    setProgress(0);
  };

  return (
    <div
      className="mx-auto w-full max-w-[320px]"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName.match(/INPUT|TEXTAREA/)) return;
        if (e.key === "ArrowRight") go(current + 1);
        if (e.key === "ArrowLeft") go(current - 1);
      }}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-[28px] bg-black shadow-3 ring-1",
          editing ? "ring-primary-border" : "ring-border/70",
        )}
        style={{ aspectRatio: "9 / 16", maxHeight: 568 }}
      >
        <div ref={frameRef} className="absolute inset-0">
          {isVideo ? (
            videoUrl ? (
              <video
                src={videoUrl}
                className="size-full object-cover"
                autoPlay={!reduce}
                muted
                loop
                playsInline
                controls={false}
              />
            ) : (
              <div className="grid size-full place-items-center text-xs text-white/70">
                {video?.status === "failed" ? "The video didn't render." : "Making the video…"}
              </div>
            )
          ) : generatedFrames?.length ? (
            generatedFrames[current]?.status === "ready" && generatedFrames[current]?.url ? (
              <img
                src={generatedFrames[current].url}
                alt={`Story frame ${current + 1}: ${frame?.heading ?? ""}`}
                className="size-full object-cover"
              />
            ) : (
              <div className="grid size-full place-items-center bg-surface-2 px-8 text-center text-sm text-muted-foreground">
                {generatedFrames[current]?.status === "failed"
                  ? "This frame needs another render."
                  : "Creating Story artwork…"}
              </div>
            )
          ) : width > 0 && frame ? (
            <StoryArt
              frames={frames}
              index={current}
              design={look.design}
              theme={look.theme}
              width={width}
              height={height}
              brand={spec?.brand || brand.name}
              site={spec?.site}
              background={current === 0 ? photo : null}
            />
          ) : null}
        </div>

        {/* The app's own chrome, drawn over the frame like on a phone. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 p-2.5">
          <div className="flex gap-1">
            {Array.from({ length: count }, (_, i) => (
              <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
                <span
                  className="block h-full rounded-full bg-white"
                  style={{
                    width:
                      i < current
                        ? "100%"
                        : i === current
                          ? `${(isVideo ? 1 : progress) * 100}%`
                          : "0%",
                  }}
                />
              </span>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-full bg-white/90 text-[11px] font-semibold text-black ring-2 ring-white/40">
              {brand.initial}
            </span>
            <span className="text-xs font-semibold text-white drop-shadow">{brand.name}</span>
            <span className="text-xs text-white/70 drop-shadow">now</span>
          </div>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 p-3"
        >
          <span className="flex-1 rounded-full border border-white/60 px-3 py-1.5 text-xs text-white/85">
            Send message
          </span>
          <Send className="size-4 text-white drop-shadow" />
        </div>

        {showZones ? (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div
              className="absolute inset-x-0 top-0 border-b border-dashed border-white/80 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.18)_0_6px,transparent_6px_12px)]"
              style={{ height: `${STORY_SAFE_ZONE.top * 100}%` }}
            />
            <div
              className="absolute inset-x-0 bottom-0 border-t border-dashed border-white/80 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.18)_0_6px,transparent_6px_12px)]"
              style={{ height: `${STORY_SAFE_ZONE.bottom * 100}%` }}
            />
          </div>
        ) : null}

        {!isVideo && count > 1 ? (
          <>
            <button
              type="button"
              aria-label="Previous frame"
              onClick={() => go(current - 1)}
              className="absolute inset-y-0 left-0 w-1/3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
            />
            <button
              type="button"
              aria-label="Next frame"
              onClick={() => go(current + 1)}
              className="absolute inset-y-0 right-0 w-1/3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
            />
          </>
        ) : null}
      </div>

      <div className="mt-3 flex items-center justify-center gap-2">
        {!isVideo && count > 1 ? (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-3 px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-2"
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? "Play" : "Pause"}
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={showZones}
          onClick={() => setShowZones((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-3 px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-2"
        >
          {showZones ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          {showZones ? "Hide app buttons" : "Show app buttons"}
        </button>
      </div>
      <p className="mt-2 text-center text-xs tabular-nums text-muted-foreground">
        {isVideo
          ? "Video Story · 9:16"
          : `Frame ${current + 1} of ${count} · about ${IMAGE_FRAME_SECONDS}s each`}
      </p>

      {editing && frame && !isVideo ? (
        <div className="mt-4 space-y-2">
          <input
            value={frame.kicker ?? ""}
            onChange={(e) =>
              onFrameChange?.(current, { ...frame, kicker: e.target.value.slice(0, 24) })
            }
            aria-label={`Frame ${current + 1} label`}
            placeholder="Small label (optional)"
            className={FIELD}
          />
          <textarea
            value={frame.heading}
            onChange={(e) =>
              onFrameChange?.(current, {
                ...frame,
                heading: e.target.value.replace(/\n/g, " ").slice(0, 90),
                emphasis: undefined,
              })
            }
            aria-label={`Frame ${current + 1} headline`}
            rows={2}
            className={cn(FIELD, "font-semibold")}
          />
          <textarea
            value={frame.body}
            onChange={(e) =>
              onFrameChange?.(current, { ...frame, body: e.target.value.slice(0, 180) })
            }
            aria-label={`Frame ${current + 1} text`}
            placeholder="One short line (optional)"
            rows={2}
            className={FIELD}
          />
          {frame.role === "question" ? (
            <div className="grid grid-cols-2 gap-2">
              {[0, 1, 2, 3].map((k) => (
                <input
                  key={k}
                  value={frame.options?.[k] ?? ""}
                  onChange={(e) => {
                    const next = [...(frame.options ?? [])];
                    next[k] = e.target.value.slice(0, 28);
                    onFrameChange?.(current, {
                      ...frame,
                      options: next.filter((o, i) => o || i < 2),
                    });
                  }}
                  aria-label={`Answer ${String.fromCharCode(65 + k)}`}
                  placeholder={`Answer ${String.fromCharCode(65 + k)}${k > 1 ? " (optional)" : ""}`}
                  className={FIELD}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
