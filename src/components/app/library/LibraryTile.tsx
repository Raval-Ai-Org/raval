"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Copy,
  Heart,
  MoreHorizontal,
  RotateCcw,
  Share,
  Sparkles,
  ThumbsDown,
} from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DownloadAssetButton } from "@/components/app/DownloadAssetButton";
import { PIN_BUTTON, PinBadge, PinButton, PinCard } from "@/components/app/pins";
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

const BURST = [0, 60, 120, 180, 240, 300];

/** One Library tile: a pin with hearts, download, share and a ••• menu. */
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
    <div data-testid="library-tile" data-reaction={props.reaction ?? ""}>
      <PinCard
        openLabel={props.openLabel}
        onOpen={props.onOpen}
        onDoubleOpen={() => love(true)}
        ratio={props.ratio}
        src={props.kind === "text" ? null : props.src}
        kind={props.kind === "video" ? "video" : "image"}
        mediaTestId="library-tile-media"
        onMeasured={props.onMeasured}
        dimmed={less}
        footer={props.footer}
        content={
          props.kind === "text" ? (
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
          ) : undefined
        }
        topRight={
          props.isNew ? (
            <PinBadge>
              <span data-testid="library-new" className="inline-flex items-center gap-1">
                <Sparkles className="size-3" />
                New
              </span>
            </PinBadge>
          ) : undefined
        }
        topLeft={
          loved || props.flag ? (
            <>
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
              {props.flag ? <PinBadge tone={props.flag.tone}>{props.flag.label}</PinBadge> : null}
            </>
          ) : undefined
        }
        overlay={
          // Big heart on double-click
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
        }
        actions={
          <>
            {hearts ? (
              <motion.button
                type="button"
                whileTap={reduce ? undefined : { scale: 0.85 }}
                onClick={() => love()}
                aria-label={loved ? "Loved" : "Love"}
                aria-pressed={loved}
                title={loved ? "Loved: Mellox makes more like this" : "Love: make more like this"}
                className={cn(
                  PIN_BUTTON,
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
                className={cn(PIN_BUTTON, "size-9 text-neutral-900 [&_svg]:size-4")}
              />
            ) : null}
            {props.onShare && props.src ? (
              // On a narrow tile Share lives in the ••• menu instead.
              <PinButton
                onClick={props.onShare}
                aria-label="Share"
                className="hidden @[12.5rem]/tile:grid"
              >
                <Share className="size-4" />
              </PinButton>
            ) : null}
            {props.actions?.length || hearts || props.onShare ? (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <PinButton aria-label="More">
                    <MoreHorizontal className="size-4" />
                  </PinButton>
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
          </>
        }
      />
    </div>
  );
}
