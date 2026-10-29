"use client";

// Inspo's building blocks: floating cards, the drop zone, chips and the
// strength ring. Presentational only.
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Heart,
  ImagePlus,
  Play,
  ShoppingBag,
  ThumbsDown,
  Trash,
  User,
  Wand,
} from "@/components/icons";
import { dsFocus, dsIconBtn } from "@/components/app/surface/buttons";
import { CHIPS, type InspoCard, type InspoChip } from "@/lib/inspo/board";
import { cn } from "@/lib/utils";
import type { InspoUpload } from "./types";

export const EASE = [0.16, 1, 0.3, 1] as const;

export const CHIP_ICON: Record<InspoChip, React.ComponentType<{ className?: string }>> = {
  like: Heart,
  avoid: ThumbsDown,
  product: ShoppingBag,
  person: User,
};

const CHIP_TONE: Record<InspoChip, string> = {
  like: "bg-primary/15 text-foreground ring-primary/30 [&_svg]:text-primary",
  avoid: "bg-destructive/12 text-destructive ring-destructive/25",
  product: "bg-[var(--ds-tile-bg)] text-foreground ring-[var(--ds-tile-border)]",
  person: "bg-[var(--ds-tile-bg)] text-foreground ring-[var(--ds-tile-border)]",
};

export function ChipPill({ chip, className }: { chip: InspoChip; className?: string }) {
  const Icon = CHIP_ICON[chip];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11.5px] font-semibold ring-1 backdrop-blur-md",
        CHIP_TONE[chip],
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {CHIPS[chip].label}
    </span>
  );
}

/** A soft block on a page: optional small label, then content. */
export function Block({
  label,
  aside,
  className,
  children,
}: {
  label?: string;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[24px] bg-[var(--ds-tile-bg)] p-4 ring-1 ring-[var(--ds-tile-border)] sm:p-5",
        className,
      )}
    >
      {(label || aside) && (
        <div className="mb-3.5 flex min-h-7 items-center justify-between gap-3">
          {label && <span className="text-[13.5px] font-semibold tracking-tight">{label}</span>}
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

/** Holo-style strength ring: a number, a word, a ring that fills. */
export function StrengthRing({
  score,
  level,
  size = 56,
}: {
  score: number;
  level: string;
  size?: number;
}) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3" data-testid="inspo-strength">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={6}
            className="stroke-[var(--ds-well-bg-hover)]"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={6}
            strokeLinecap="round"
            className="stroke-primary"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: c * (1 - score / 100) }}
            transition={{ duration: 1.1, ease: EASE }}
          />
        </svg>
        <span className="absolute inset-0 grid place-items-center text-[13px] font-bold tabular-nums">
          {score}%
        </span>
      </div>
      <div className="min-w-0 leading-tight">
        <div className="text-[13.5px] font-semibold">Style strength</div>
        <div
          className={cn(
            "text-[12px] font-semibold",
            score >= 80 ? "text-primary" : score >= 45 ? "text-foreground/70" : "text-warning",
          )}
        >
          {level}
        </div>
      </div>
    </div>
  );
}

/** The big drop zone. Also takes pasted images or links while the page is open. */
export function InspoDrop({
  onFiles,
  onLink,
  disabled,
  title,
  compact,
  thumbs = [],
}: {
  onFiles: (files: File[]) => void;
  onLink?: (url: string) => void;
  disabled?: boolean;
  title: string;
  compact?: boolean;
  thumbs?: string[];
}) {
  const [over, setOver] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        onFiles(files);
        return;
      }
      const text = e.clipboardData?.getData("text")?.trim() ?? "";
      if (onLink && /^https?:\/\/\S+$/i.test(text)) {
        e.preventDefault();
        onLink(text);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [disabled, onFiles, onLink]);

  return (
    <motion.div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      data-testid="inspo-drop"
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !disabled) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length) onFiles(files);
        else {
          const text = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text");
          if (onLink && /^https?:\/\/\S+$/i.test(text.trim())) onLink(text.trim());
        }
      }}
      animate={{ scale: over ? 1.012 : 1 }}
      transition={{ duration: 0.25, ease: EASE }}
      className={cn(
        "group relative isolate flex cursor-pointer items-center gap-5 overflow-hidden rounded-[28px] border-2 border-dashed transition-colors duration-300",
        compact
          ? "min-h-[120px] p-4"
          : "min-h-[200px] flex-col justify-center p-6 text-center sm:flex-row sm:text-left",
        over
          ? "border-primary bg-primary/[0.07]"
          : "border-[var(--ds-tile-border)] bg-[var(--ds-tile-bg)] hover:border-primary/45",
        disabled && "pointer-events-none opacity-60",
        dsFocus,
      )}
    >
      {/* A soft lime glow that breathes while something is dragged over. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -inset-20 -z-10 rounded-full bg-[radial-gradient(closest-side,hsl(var(--primary)/0.18),transparent)] transition-opacity duration-500",
          over ? "animate-pulse opacity-100" : "opacity-0 group-hover:opacity-60",
        )}
      />
      {!compact && (
        <div className="relative h-[112px] w-[150px] shrink-0" aria-hidden>
          {[0, 1, 2].map((i) => {
            const src = thumbs[i];
            return (
              <motion.span
                key={i}
                className="absolute top-2 h-[92px] w-[72px] overflow-hidden rounded-[16px] bg-[var(--ds-well-bg-hover)] shadow-[0_10px_30px_-12px_rgb(0_0_0/0.35)] ring-4 ring-[var(--ds-tile-bg)]"
                style={{ left: 8 + i * 34, zIndex: i === 1 ? 2 : 1 }}
                initial={{ rotate: (i - 1) * 9, y: i === 1 ? -6 : 4 }}
                animate={
                  over
                    ? { rotate: (i - 1) * 16, y: i === 1 ? -14 : 0, x: (i - 1) * 6 }
                    : { rotate: (i - 1) * 9, y: i === 1 ? -6 : 4, x: 0 }
                }
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
              >
                {src ? (
                  <img src={src} alt="" className="size-full object-cover" decoding="async" />
                ) : (
                  <span
                    className="block size-full"
                    style={{
                      background:
                        i === 1
                          ? "linear-gradient(160deg, hsl(var(--primary)/0.55), hsl(var(--primary)/0.15))"
                          : "linear-gradient(160deg, var(--ds-well-bg-hover), var(--ds-well-bg))",
                    }}
                  />
                )}
              </motion.span>
            );
          })}
        </div>
      )}
      <div className={cn("min-w-0", compact && "flex flex-1 items-center gap-3")}>
        {compact && (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary transition-transform group-hover:scale-105">
            <ImagePlus className="h-5 w-5" />
          </span>
        )}
        <div>
          <div
            className={cn("font-semibold tracking-tight", compact ? "text-[14px]" : "text-[18px]")}
          >
            {over ? "Let go to add" : title}
          </div>
          <div className="mt-1 text-[12.5px] text-muted-foreground">
            Drop, paste or click · images & videos
          </div>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </motion.div>
  );
}

function CardMedia({ card }: { card: InspoCard }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  if (card.kind === "video")
    return (
      <div className="relative">
        <video
          ref={ref}
          src={card.url ?? undefined}
          muted
          loop
          playsInline
          preload="metadata"
          className="block aspect-[4/5] w-full bg-black object-cover"
          onMouseEnter={() => void ref.current?.play().catch(() => {})}
          onMouseLeave={() => ref.current?.pause()}
        />
        <span className="pointer-events-none absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition-opacity group-hover:opacity-0">
          <Play className="h-4 w-4" />
        </span>
      </div>
    );
  return card.thumbUrl ? (
    <img
      src={card.thumbUrl}
      alt={card.label}
      loading="lazy"
      decoding="async"
      className="block w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04]"
    />
  ) : (
    <div className="aspect-square w-full bg-[var(--ds-well-bg)]" />
  );
}

export function InspoCardView({
  card,
  chips,
  canEdit,
  onChip,
  onRemove,
  onUse,
}: {
  card: InspoCard;
  chips: InspoChip[];
  canEdit: boolean;
  onChip: (chip: InspoChip) => void;
  onRemove: () => void;
  onUse?: () => void;
}) {
  return (
    <motion.figure
      layout="position"
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
      transition={{ duration: 0.4, ease: EASE }}
      whileHover={{ y: -3 }}
      className="group relative mb-3 break-inside-avoid overflow-hidden rounded-[20px] bg-[var(--ds-well-bg)] ring-1 ring-[var(--ds-tile-border)] transition-shadow duration-300 hover:shadow-[0_18px_40px_-18px_rgb(0_0_0/0.35)]"
      data-testid="inspo-card"
    >
      <CardMedia card={card} />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/45 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <figcaption className="absolute left-2 top-2 flex gap-1">
        <ChipPill chip={card.chip} />
        {card.fromSite && (
          <span className="inline-flex h-6 items-center rounded-full bg-black/40 px-2 text-[11px] font-medium text-white backdrop-blur">
            Your site
          </span>
        )}
      </figcaption>
      {canEdit && (
        <div className="absolute inset-x-2 bottom-2 flex translate-y-2 items-center justify-between gap-1 opacity-0 transition-all duration-300 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
          <div className="flex rounded-full bg-black/45 p-0.5 backdrop-blur-md">
            {chips.map((chip) => {
              const Icon = CHIP_ICON[chip];
              const on = chip === card.chip;
              return (
                <button
                  key={chip}
                  type="button"
                  aria-label={`Mark as ${CHIPS[chip].label}`}
                  aria-pressed={on}
                  onClick={() => onChip(chip)}
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full text-white/85 transition-colors hover:text-white",
                    on && "bg-white/25 text-white",
                    dsFocus,
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>
          <div className="flex gap-1">
            {onUse && card.chip !== "avoid" && (
              <button
                type="button"
                onClick={onUse}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-[12px] font-semibold text-primary-foreground shadow-sm transition-transform hover:scale-[1.04]",
                  dsFocus,
                )}
              >
                <Wand className="h-3.5 w-3.5" /> Use
              </button>
            )}
            <button
              type="button"
              aria-label="Remove"
              onClick={onRemove}
              className={cn(
                dsIconBtn,
                "bg-black/45 text-white/90 backdrop-blur-md hover:bg-black/60 hover:text-white",
              )}
            >
              <Trash className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </motion.figure>
  );
}

export function UploadCardView({ upload }: { upload: InspoUpload }) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="relative mb-3 break-inside-avoid overflow-hidden rounded-[20px] bg-[var(--ds-well-bg)] ring-1 ring-primary/30"
      data-testid="inspo-uploading"
    >
      {upload.previewUrl ? (
        <img src={upload.previewUrl} alt="" className="block w-full object-cover opacity-60" />
      ) : (
        <div className="aspect-[4/5] w-full" />
      )}
      <span className="skeleton-shimmer pointer-events-none absolute inset-0" aria-hidden />
      <span className="absolute inset-x-2 bottom-2 truncate rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
        Adding…
      </span>
    </motion.div>
  );
}

/** Masonry of cards with enter/leave motion. */
export function CardWall({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="columns-2 gap-3 sm:columns-3 xl:columns-4" data-testid={testId}>
      <AnimatePresence mode="popLayout" initial={false}>
        {children}
      </AnimatePresence>
    </div>
  );
}

/** A round option tile used for vibes, mediums and the like. */
export function PickTile({
  on,
  label,
  art,
  onClick,
  index = 0,
  className,
}: {
  on: boolean;
  label: string;
  art: string;
  onClick: () => void;
  index?: number;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 8) * 0.035, ease: EASE }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "group relative overflow-hidden rounded-[20px] text-left ring-1 transition-shadow",
        on
          ? "ring-2 ring-primary shadow-[0_10px_30px_-14px_hsl(var(--primary)/0.8)]"
          : "ring-[var(--ds-tile-border)] hover:ring-primary/40",
        dsFocus,
        className,
      )}
    >
      <span className="block aspect-[5/4] w-full" style={{ background: art }} aria-hidden />
      <span className="flex items-center justify-between gap-2 bg-[var(--ds-tile-bg)] px-3 py-2 text-[12.5px] font-semibold">
        {label}
        <AnimatePresence>
          {on && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="grid h-4.5 w-4.5 place-items-center rounded-full bg-primary text-primary-foreground"
            >
              <Check className="h-3 w-3" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.button>
  );
}
