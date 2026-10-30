"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Image as ImageIcon, Video as VideoIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * The pin: Mellox's one card for anything visual (docs/design-system.md,
 * "Pinterest language"). The whole picture at its true shape, a 20px frame,
 * actions that appear on hover over a soft gradient, and at most a title and
 * one meta line underneath.
 */

/** The frame every pin and pin skeleton shares. */
export const PIN_FRAME =
  "relative w-full overflow-hidden rounded-[var(--ds-radius-tile)] bg-surface-2 ring-1 ring-border/60";

/** The white round button that sits on a picture. Fixed white in both themes. */
export const PIN_BUTTON =
  "grid size-9 place-items-center rounded-full bg-white/95 text-neutral-900 shadow-[0_6px_18px_-8px_rgba(0,0,0,0.55)] ring-1 ring-black/5 backdrop-blur transition-[transform,background-color] duration-200 hover:scale-105 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:scale-95";

export const PinButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function PinButton({ className, type = "button", ...props }, ref) {
    return <button ref={ref} type={type} className={cn(PIN_BUTTON, className)} {...props} />;
  },
);

export type PinCardProps = {
  /** Accessible name for the click target that covers the pin. */
  openLabel: string;
  onOpen: () => void;
  onDoubleOpen?: () => void;
  /** Width ÷ height; the pin takes exactly this shape. */
  ratio: number;
  src?: string | null;
  kind?: "image" | "video";
  /** Drawn instead of the picture (text posts, covers, collages). */
  content?: ReactNode;
  /** Top-left / top-right corner badges. */
  topLeft?: ReactNode;
  topRight?: ReactNode;
  /** Buttons revealed on hover along the bottom (use PinButton). */
  actions?: ReactNode;
  /** Anything else drawn over the picture (animations). */
  overlay?: ReactNode;
  footer?: ReactNode;
  dimmed?: boolean;
  testId?: string;
  mediaTestId?: string;
  /** The picture's real shape once it loaded. */
  onMeasured?: (ratio: number) => void;
  className?: string;
};

export function PinCard(props: PinCardProps) {
  return (
    <div data-testid={props.testId} className={cn("group/tile @container/tile", props.className)}>
      <div
        className={cn(
          PIN_FRAME,
          "transition-[box-shadow,transform] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
          "group-hover/tile:-translate-y-0.5 group-hover/tile:shadow-[var(--ds-tile-shadow-hover)]",
          props.dimmed && "opacity-60 saturate-50",
        )}
        style={{ aspectRatio: String(props.ratio) }}
      >
        <button
          type="button"
          onClick={props.onOpen}
          onDoubleClick={
            props.onDoubleOpen
              ? (e) => {
                  e.preventDefault();
                  props.onDoubleOpen?.();
                }
              : undefined
          }
          aria-label={props.openLabel}
          className="absolute inset-0 z-10 rounded-[var(--ds-radius-tile)] bg-transparent outline-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
        />
        {props.content ? (
          props.content
        ) : props.src ? (
          <PinMedia
            src={props.src}
            kind={props.kind ?? "image"}
            testId={props.mediaTestId}
            onMeasured={props.onMeasured}
          />
        ) : (
          <span className="grid size-full place-items-center text-muted-foreground">
            {props.kind === "video" ? (
              <VideoIcon className="size-7" />
            ) : (
              <ImageIcon className="size-7" />
            )}
          </span>
        )}

        {props.topRight ? (
          <span className="pointer-events-none absolute right-2.5 top-2.5 z-20">
            {props.topRight}
          </span>
        ) : null}
        {props.topLeft ? (
          <span className="pointer-events-none absolute left-2.5 top-2.5 z-20 flex max-w-[60%] items-center gap-1.5">
            {props.topLeft}
          </span>
        ) : null}
        {props.overlay}

        {props.actions ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-black/45 via-black/10 to-transparent px-2 pb-2.5 pt-10 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 [@media(hover:none)]:opacity-100">
            <div className="pointer-events-auto flex items-center gap-1.5">{props.actions}</div>
          </div>
        ) : null}
      </div>
      {props.footer}
    </div>
  );
}

/** A picture or a muted looping video that fills the pin without cropping. */
export function PinMedia({
  src,
  kind,
  testId,
  onMeasured,
}: {
  src: string;
  kind: "image" | "video";
  testId?: string;
  onMeasured?: (ratio: number) => void;
}) {
  if (kind === "video")
    return (
      <video
        src={src}
        muted
        playsInline
        loop
        preload="metadata"
        data-testid={testId}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth && v.videoHeight) onMeasured?.(v.videoWidth / v.videoHeight);
        }}
        onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
        onMouseLeave={(e) => e.currentTarget.pause()}
        className="size-full bg-black object-contain"
      />
    );
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      data-testid={testId}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth && img.naturalHeight)
          onMeasured?.(img.naturalWidth / img.naturalHeight);
      }}
      className="size-full object-contain transition-transform duration-700 group-hover/tile:scale-[1.015]"
    />
  );
}

/** Title and one meta line under a pin. */
export function PinFooter({ title, meta }: { title?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="px-1 pb-1 pt-2">
      {title ? (
        <p className="truncate text-[13px] font-medium leading-snug text-foreground">{title}</p>
      ) : null}
      {meta ? (
        <p
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground",
            title && "mt-0.5",
          )}
        >
          {meta}
        </p>
      ) : null}
    </div>
  );
}

/** A small pill on a picture: "New", "Needs approval". */
export function PinBadge({
  children,
  tone = "primary",
  className,
}: {
  children: ReactNode;
  tone?: "primary" | "warn" | "danger" | "dark";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10px] font-semibold",
        tone === "primary" &&
          "bg-primary font-bold text-primary-foreground shadow-[0_6px_16px_-6px_hsl(var(--primary)/0.8)]",
        tone === "warn" &&
          "bg-warning-surface/95 text-warning ring-1 ring-warning-border backdrop-blur",
        tone === "danger" &&
          "bg-danger-surface/95 text-danger ring-1 ring-danger-border backdrop-blur",
        tone === "dark" && "bg-black/55 text-white backdrop-blur",
        className,
      )}
    >
      {children}
    </span>
  );
}
