"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Copy,
  Heart,
  Image as ImageIcon,
  MoreHorizontal,
  RotateCcw,
  Share,
  Sparkles,
  ThumbsDown,
  Video as VideoIcon,
} from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DownloadAssetButton } from "@/components/app/DownloadAssetButton";
import { TypeGlyph } from "@/components/studio/studio-ui";
import type { StudioType } from "@/lib/studio/formats";
import type { Reaction } from "@/lib/taste/contracts";
import { cn } from "@/lib/utils";

export type TileAction = {
  id: string;
  label: string;
  icon: typeof Copy;
  onSelect: () => void;
};

export type LibraryTileProps = {
  /** Accessible name for the open button ("Open content: …"). */
  openLabel: string;
  src?: string | null;
  kind: "image" | "video" | "text";
  /** Width ÷ height of the picture; the tile takes exactly this shape. */
  ratio: number;
  /** Text-only posts: what the tile shows instead of a picture. */
  excerpt?: string;
  type?: StudioType;
  /** A small pill for something that needs a person ("Needs approval"). */
  flag?: { label: string; tone: "warn" | "danger" } | null;
  isNew?: boolean;
  /** null when this brand hasn't reacted; undefined hides the hearts. */
  reaction?: Reaction | null;
  downloadName: string;
  mimeType?: string | null;
  footer?: ReactNode;
  actions?: TileAction[];
  onOpen: () => void;
  onReact?: (next: Reaction | null) => void;
  onShare?: () => void;
  /** The picture's real shape once it loaded (when the stored ratio was unknown). */
  onMeasured?: (ratio: number) => void;
};

const ROUND =
  "grid size-9 place-items-center rounded-full bg-white/95 text-neutral-900 shadow-[0_6px_18px_-8px_rgba(0,0,0,0.55)] ring-1 ring-black/5 backdrop-blur transition-[transform,background-color] duration-200 hover:scale-105 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:scale-95";

const FLAG_TONE = {
  warn: "bg-warning-surface/95 text-warning ring-warning-border",
  danger: "bg-danger-surface/95 text-danger ring-danger-border",
} as const;

const BURST = [0, 60, 120, 180, 240, 300];

/** One Library tile: the whole picture at its true shape, never cropped. */
export function LibraryTile(props: LibraryTileProps) {
  const reduce = useReducedMotion();
  const [burst, setBurst] = useState(0);
  const loved = props.reaction === "love";
  const less = props.reaction === "less";
  const hearts = props.reaction !== undefined && !!props.onReact;

  const love = (force?: boolean) => {
    if (!props.onReact) return;
    if (loved && !force) return props.onReact(null);
    if (!loved) {
      props.onReact("love");
      setBurst((b) => b + 1);
    }
  };

  return (
    <div
      data-testid="library-tile"
      data-reaction={props.reaction ?? ""}
      className="group/tile @container/tile"
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-[20px] bg-surface-2 ring-1 ring-border/60",
          "transition-[box-shadow,transform] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
          "group-hover/tile:-translate-y-0.5 group-hover/tile:shadow-[0_22px_40px_-24px_rgba(0,0,0,0.55)]",
          less && "opacity-60 saturate-50",
        )}
        style={{ aspectRatio: String(props.ratio) }}
      >
        <button
          type="button"
          onClick={props.onOpen}
          onDoubleClick={(e) => {
            e.preventDefault();
            love(true);
          }}
          aria-label={props.openLabel}
          className="absolute inset-0 z-10 rounded-[20px] bg-transparent outline-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60"
        />
        {props.kind === "image" && props.src ? (
          <img
            src={props.src}
            alt=""
            loading="lazy"
            data-testid="library-tile-media"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight)
                props.onMeasured?.(img.naturalWidth / img.naturalHeight);
            }}
            className="size-full object-contain transition-transform duration-700 group-hover/tile:scale-[1.015]"
          />
        ) : props.kind === "video" && props.src ? (
          <video
            src={props.src}
            muted
            playsInline
            loop
            preload="metadata"
            data-testid="library-tile-media"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth && v.videoHeight) props.onMeasured?.(v.videoWidth / v.videoHeight);
            }}
            onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
            onMouseLeave={(e) => e.currentTarget.pause()}
            className="size-full bg-black object-contain"
          />
        ) : props.kind === "text" ? (
          <span
            className={cn(
              props.type ? `studio-tone-${props.type}` : "",
              "absolute inset-0 flex flex-col bg-gradient-to-br from-[hsl(var(--tone,var(--primary))/0.18)] via-surface-2 to-surface-2 p-4",
            )}
          >
            <span className="line-clamp-[8] text-[13px] font-medium leading-snug text-foreground/85">
              {props.excerpt}
            </span>
            {props.type ? <TypeGlyph type={props.type} className="mt-auto" /> : null}
          </span>
        ) : (
          <span className="grid size-full place-items-center text-muted-foreground">
            {props.kind === "video" ? (
              <VideoIcon className="size-7" />
            ) : (
              <ImageIcon className="size-7" />
            )}
          </span>
        )}

        {/* Corner badges */}
        {props.isNew ? (
          <span
            data-testid="library-new"
            className="pointer-events-none absolute right-2.5 top-2.5 z-20 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground shadow-[0_6px_16px_-6px_hsl(var(--primary)/0.8)]"
          >
            <Sparkles className="size-3" />
            New
          </span>
        ) : null}
        <span className="pointer-events-none absolute left-2.5 top-2.5 z-20 flex max-w-[60%] items-center gap-1.5">
          <AnimatePresence>
            {loved ? (
              <motion.span
                key="loved"
                data-testid="library-loved-badge"
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: "spring", stiffness: 520, damping: 22 }}
                className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_16px_-6px_hsl(var(--primary)/0.8)]"
              >
                <Heart className="size-3.5 fill-current" />
              </motion.span>
            ) : null}
          </AnimatePresence>
          {props.flag ? (
            <span
              className={cn(
                "truncate rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 backdrop-blur",
                FLAG_TONE[props.flag.tone],
              )}
            >
              {props.flag.label}
            </span>
          ) : null}
        </span>

        {/* Big heart on double-click */}
        <AnimatePresence>
          {burst && !reduce ? (
            <motion.span
              key={burst}
              aria-hidden
              className="pointer-events-none absolute inset-0 z-20 grid place-items-center"
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ delay: 0.45, duration: 0.35 }}
              onAnimationComplete={() => setBurst(0)}
            >
              <motion.span
                initial={{ scale: 0.3 }}
                animate={{ scale: [0.3, 1.15, 1] }}
                transition={{ duration: 0.45, ease: "easeOut" }}
                className="relative grid size-20 place-items-center rounded-full bg-primary/90 text-primary-foreground shadow-[0_0_60px_hsl(var(--primary)/0.7)]"
              >
                <Heart className="size-9 fill-current" />
                {BURST.map((deg) => (
                  <motion.span
                    key={deg}
                    className="absolute size-2 rounded-full bg-primary"
                    initial={{ x: 0, y: 0, opacity: 1 }}
                    animate={{
                      x: Math.cos((deg * Math.PI) / 180) * 64,
                      y: Math.sin((deg * Math.PI) / 180) * 64,
                      opacity: 0,
                    }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                  />
                ))}
              </motion.span>
            </motion.span>
          ) : null}
        </AnimatePresence>

        {/* Hover actions */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-black/45 via-black/10 to-transparent px-2 pb-2.5 pt-10 opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 [@media(hover:none)]:opacity-100">
          <div className="pointer-events-auto flex items-center gap-1.5">
            {hearts ? (
              <motion.button
                type="button"
                whileTap={reduce ? undefined : { scale: 0.85 }}
                onClick={() => love()}
                aria-label={loved ? "Loved" : "Love"}
                aria-pressed={loved}
                title={loved ? "Loved: Mellox makes more like this" : "Love: make more like this"}
                className={cn(
                  ROUND,
                  loved && "bg-primary text-primary-foreground hover:bg-primary",
                )}
              >
                <Heart className={cn("size-4", loved && "fill-current")} />
              </motion.button>
            ) : null}
            {props.src ? (
              <DownloadAssetButton
                url={props.src}
                filename={props.downloadName}
                mimeType={props.mimeType}
                compact
                className={cn(ROUND, "size-9 text-neutral-900 [&_svg]:size-4")}
              />
            ) : null}
            {props.onShare && props.src ? (
              // On a narrow tile Share lives in the ••• menu instead.
              <button
                type="button"
                onClick={props.onShare}
                aria-label="Share"
                className={cn(ROUND, "hidden @[12.5rem]/tile:grid")}
              >
                <Share className="size-4" />
              </button>
            ) : null}
            {props.actions?.length || hearts || props.onShare ? (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label="More" className={ROUND}>
                    <MoreHorizontal className="size-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={8}
                  className="min-w-48 rounded-2xl p-1.5"
                >
                  {props.actions?.map((a) => (
                    <DropdownMenuItem
                      key={a.id}
                      onSelect={a.onSelect}
                      className="gap-2 rounded-xl px-2.5 py-2"
                    >
                      <a.icon className="size-4" />
                      {a.label}
                    </DropdownMenuItem>
                  ))}
                  {props.onShare && props.src ? (
                    // The menu is portaled out of the tile, so it always offers Share.
                    <DropdownMenuItem
                      onSelect={props.onShare}
                      className="gap-2 rounded-xl px-2.5 py-2"
                    >
                      <Share className="size-4" />
                      Share
                    </DropdownMenuItem>
                  ) : null}
                  {hearts ? (
                    <>
                      {props.actions?.length ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuItem
                        onSelect={() => props.onReact?.(less ? null : "less")}
                        className="gap-2 rounded-xl px-2.5 py-2"
                      >
                        {less ? (
                          <RotateCcw className="size-4" />
                        ) : (
                          <ThumbsDown className="size-4" />
                        )}
                        {less ? "Show more like this again" : "Less like this"}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </div>
      {props.footer}
    </div>
  );
}
