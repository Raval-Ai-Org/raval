"use client";

import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Download, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { duration, ease, spring } from "@/lib/motion";
import { RATIOS, type AspectRatio } from "@/lib/studio/aspect";
import type { MediaOutput } from "@/lib/studio/jobs";

const CONTROL =
  "grid size-9 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";

/**
 * Full-screen viewing for generated media: fitted to the screen by default,
 * one click (or Z) for full resolution, Esc to return to the review.
 */
export function MediaLightbox({
  open,
  onOpenChange,
  media,
  ratio,
  alt,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  media: MediaOutput | null;
  ratio: AspectRatio;
  alt: string;
  title?: string;
}) {
  const reduce = useReducedMotion();
  const [zoom, setZoom] = useState(false);
  const isVideo = media?.kind === "video";

  useEffect(() => {
    if (!open) setZoom(false);
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && media?.url ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: duration.base }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              asChild
              aria-describedby={undefined}
              onKeyDown={(e) => {
                if (!isVideo && (e.key === "z" || e.key === "Z")) setZoom((z) => !z);
              }}
            >
              <motion.div
                className="fixed inset-0 z-[60] flex flex-col outline-none"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: duration.fast } }}
              >
                <div className="flex h-14 shrink-0 items-center gap-3 px-3 text-white sm:px-5">
                  <DialogPrimitive.Title className="min-w-0 truncate text-sm font-medium text-white/90">
                    {title ?? "Preview"}
                  </DialogPrimitive.Title>
                  <span className="hidden shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] tabular-nums text-white/70 sm:inline">
                    {RATIOS[ratio].label} · {ratio}
                  </span>
                  <div className="ml-auto flex items-center gap-1">
                    {!isVideo ? (
                      <button
                        type="button"
                        className={CONTROL}
                        onClick={() => setZoom((z) => !z)}
                        aria-label={zoom ? "Fit to screen" : "View full resolution"}
                        title={zoom ? "Fit to screen (Z)" : "Full resolution (Z)"}
                      >
                        {zoom ? <ZoomOut className="size-4" /> : <ZoomIn className="size-4" />}
                      </button>
                    ) : null}
                    <a
                      href={media.url}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className={CONTROL}
                      aria-label="Download"
                      title="Download"
                    >
                      <Download className="size-4" />
                    </a>
                    <DialogPrimitive.Close
                      className={CONTROL}
                      aria-label="Close"
                      title="Close (Esc)"
                    >
                      <X className="size-4" />
                    </DialogPrimitive.Close>
                  </div>
                </div>

                <div
                  className={cn(
                    "relative min-h-0 flex-1",
                    zoom
                      ? "overflow-auto"
                      : "grid place-items-center overflow-hidden px-3 pb-8 sm:px-10",
                  )}
                  onClick={(e) => {
                    if (e.target === e.currentTarget) onOpenChange(false);
                  }}
                >
                  {isVideo ? (
                    <motion.video
                      src={media.url}
                      controls
                      autoPlay
                      playsInline
                      initial={reduce ? false : { opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={spring.surface}
                      className="max-h-full max-w-full rounded-xl bg-black shadow-4"
                    />
                  ) : zoom ? (
                    <div className="flex min-h-full min-w-max items-center justify-center p-6">
                      <img
                        src={media.url}
                        alt={alt}
                        onClick={() => setZoom(false)}
                        className="max-w-none cursor-zoom-out rounded-lg"
                      />
                    </div>
                  ) : (
                    <motion.img
                      src={media.url}
                      alt={alt}
                      onClick={() => setZoom(true)}
                      initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      transition={{ duration: duration.slow, ease: ease.emphasized }}
                      className="max-h-full max-w-full cursor-zoom-in rounded-xl object-contain shadow-4"
                    />
                  )}
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
