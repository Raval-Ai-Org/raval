"use client";

import { AlertTriangle, Image as ImageIcon, RefreshCw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AspectRatio } from "@/lib/studio/aspect";
import type { MediaOutput } from "@/lib/studio/jobs";
import { RatioFrame, Weave } from "../studio-ui";

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
  const frame = cn("bg-surface-2", rounded && "rounded-lg", className);

  if (!media || media.status === "pending") {
    return (
      <RatioFrame ratio={ratio} maxHeight={maxHeight} className={frame}>
        <Weave />
        <div className="absolute inset-0 grid place-items-center">
          <span className="flex items-center gap-2 rounded-full bg-surface-3/90 px-3 py-1.5 text-xs text-muted-foreground shadow-1">
            <ImageIcon className="size-3.5" />
            {media?.kind === "video" ? "Rendering video…" : "Rendering visual…"}
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
        className={cn(frame, "ring-1 ring-danger-border")}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <AlertTriangle className="size-5 text-danger" />
          <p className="text-sm font-medium text-foreground">The {media.kind} didn't render</p>
          <p className="line-clamp-2 max-w-xs text-xs text-muted-foreground">
            {media.error ?? "The provider couldn't finish this one."}
          </p>
          {onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry} className="mt-1">
              <RefreshCw />
              Retry render
            </Button>
          ) : null}
        </div>
      </RatioFrame>
    );
  }

  if (!media.url) {
    return (
      <RatioFrame ratio={ratio} maxHeight={maxHeight} className={frame}>
        <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
          Loading preview…
        </div>
      </RatioFrame>
    );
  }

  return (
    <RatioFrame ratio={ratio} maxHeight={maxHeight} className={cn(frame, "bg-black")}>
      {media.kind === "video" ? (
        <video
          key={media.url}
          src={media.url}
          controls
          playsInline
          preload="metadata"
          className="absolute inset-0 size-full object-contain"
        />
      ) : (
        <button
          type="button"
          onClick={onExpand}
          disabled={!onExpand}
          className="absolute inset-0 cursor-zoom-in disabled:cursor-default"
          aria-label="Expand preview"
        >
          <img src={media.url} alt={alt} className="size-full object-cover" />
        </button>
      )}
    </RatioFrame>
  );
}
