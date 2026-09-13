"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Maximize2 } from "lucide-react";
import { AlertTriangle, RefreshCw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { RATIOS, type AspectRatio } from "@/lib/studio/aspect";
import type { MediaOutput } from "@/lib/studio/jobs";
import { RatioFrame } from "../studio-ui";

/** The media slot of a preview, at its true ratio, in every state. */
export function MediaFrame({
  media,
  ratio,
  alt,
  onRetry,
  onExpand,
  maxHeight = 520,
  className,
  rounded = true,
}: {
  media?: MediaOutput | null;
  ratio: AspectRatio;
  alt: string;
  onRetry?: () => void;
  onExpand?: () => void;
  maxHeight?: number;
  className?: string;
  rounded?: boolean;
}) {
  const reduce = useReducedMotion();
  const [loaded, setLoaded] = useState(false);
  const frame = cn(rounded && "rounded-xl", className);

  if (!media || media.status === "pending") {
    return (
      <RatioFrame ratio={ratio} maxHeight={maxHeight} className={cn(frame, "studio-develop")}>
        <div className="absolute inset-0 grid place-items-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-surface-3/90 px-3 py-1.5 text-xs font-medium text-foreground/75 shadow-1 backdrop-blur">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
            </span>
            {media?.kind === "video" ? "Rendering video" : "Developing visual"}
            <span className="text-muted-foreground">· {ratio}</span>
          </span>
        </div>
      </RatioFrame>
    );
  }

  if (media.status === "failed") {
    return (
      <RatioFrame
        ratio={ratio}
        maxHeight={maxHeight}
        className={cn(
          frame,
          "bg-[repeating-linear-gradient(135deg,hsl(var(--surface-2))_0_10px,hsl(var(--surface-1))_10px_20px)]",
        )}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-5 text-center">
          <span className="grid size-9 place-items-center rounded-full bg-danger-surface ring-1 ring-danger-border">
            <AlertTriangle className="size-4 text-danger" />
          </span>
          <p className="text-sm font-medium text-foreground">
            The {media.kind === "video" ? "video" : "visual"} didn't render
          </p>
          <p className="line-clamp-2 max-w-xs text-xs leading-relaxed text-muted-foreground">
            {media.error ?? "The provider couldn't finish this one."} Your copy is safe.
          </p>
          {onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry} className="mt-1.5">
              <RefreshCw />
              Render again
            </Button>
          ) : null}
        </div>
      </RatioFrame>
    );
  }

  if (!media.url) {
    return (
      <RatioFrame ratio={ratio} maxHeight={maxHeight} className={cn(frame, "bg-surface-2")}>
        <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
          Loading preview…
        </div>
      </RatioFrame>
    );
  }

  return (
    <RatioFrame
      ratio={ratio}
      maxHeight={maxHeight}
      className={cn(frame, "group/media bg-surface-2", !loaded && "studio-develop")}
    >
      {media.kind === "video" ? (
        <video
          key={media.url}
          src={media.url}
          controls
          playsInline
          preload="metadata"
          onLoadedData={() => setLoaded(true)}
          className="absolute inset-0 size-full bg-black object-contain"
        />
      ) : (
        <button
          type="button"
          onClick={onExpand}
          disabled={!onExpand}
          className="absolute inset-0 cursor-zoom-in overflow-hidden disabled:cursor-default"
          aria-label={`Expand ${RATIOS[ratio].label.toLowerCase()} visual`}
        >
          <motion.img
            key={media.url}
            src={media.url}
            alt={alt}
            onLoad={() => setLoaded(true)}
            ref={(el) => {
              // Cached images can finish before React attaches onLoad.
              if (el?.complete && el.naturalWidth && !loaded) setLoaded(true);
            }}
            initial={reduce ? false : { opacity: 0, scale: 1.04, filter: "blur(14px)" }}
            animate={loaded ? { opacity: 1, scale: 1, filter: "blur(0px)" } : undefined}
            transition={{ duration: 0.7, ease: ease.emphasized }}
            className="size-full object-cover transition-transform duration-[--motion-duration-xslow] ease-[--motion-ease-emphasized] group-hover/media:scale-[1.015]"
          />
        </button>
      )}
      {onExpand ? (
        <span className="pointer-events-none absolute right-2.5 top-2.5 opacity-0 transition-opacity duration-[--motion-duration-base] group-hover/media:opacity-100 group-focus-within/media:opacity-100">
          <button
            type="button"
            onClick={onExpand}
            aria-label="Open full size"
            title="Open full size"
            className="pointer-events-auto grid size-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75"
          >
            <Maximize2 className="size-3.5" />
          </button>
        </span>
      ) : null}
      {!reduce && loaded ? (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-primary"
          style={{ borderRadius: "inherit" }}
          initial={{ opacity: 0.8 }}
          animate={{ opacity: 0 }}
          transition={{ duration: duration.xslow * 2, ease: ease.standard }}
        />
      ) : null}
    </RatioFrame>
  );
}
