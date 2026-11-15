"use client";

// The picture styles a brand's posts are made in: "Let Mox decide" first,
// then real Mellox posts per style. Up to three. Used by onboarding and
// Inspo → Post look. Presentational: the caller saves.
import * as React from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check } from "@/components/icons";
import { Mox } from "@/components/brand/mox/Mox";
import {
  MAX_PICTURE_STYLES,
  PICTURE_STYLES,
  pictureStyleById,
  toggleStyle,
  type PictureStyle,
  type PictureStyleId,
} from "@/lib/brand-look/picture-styles";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

export type StylePick = { auto: boolean; ids: PictureStyleId[] };

/** A tile whose picture slowly cycles through its real examples on hover. */
function StyleTile({
  style,
  order,
  index,
  onToggle,
  size,
}: {
  style: PictureStyle;
  /** 1-3 when picked, else 0. */
  order: number;
  index: number;
  onToggle: () => void;
  size: "md" | "lg";
}) {
  const reduce = useReducedMotion();
  const [hover, setHover] = React.useState(false);
  const [shown, setShown] = React.useState(0);
  React.useEffect(() => {
    if (!hover || reduce || style.examples.length < 2) return;
    const t = window.setInterval(() => setShown((n) => (n + 1) % style.examples.length), 1100);
    return () => window.clearInterval(t);
  }, [hover, reduce, style.examples.length]);
  const on = order > 0;
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setShown(0);
      }}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 10) * 0.04, ease: EASE }}
      whileHover={reduce ? undefined : { y: -3 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-[22px] bg-[var(--ds-tile-bg,white)] text-left ring-1 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        on
          ? "ring-2 ring-primary shadow-[0_14px_34px_-16px_hsl(var(--primary)/0.9)]"
          : "ring-[var(--ds-tile-border,rgba(0,0,0,0.08))] hover:ring-primary/40",
      )}
    >
      <span className="relative block aspect-[4/5] w-full overflow-hidden bg-muted">
        <AnimatePresence initial={false}>
          <motion.span
            key={shown}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: hover && !reduce ? 1.05 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <Image
              src={style.examples[shown] ?? style.examples[0]}
              alt=""
              fill
              sizes={
                size === "lg" ? "(min-width: 768px) 200px, 45vw" : "(min-width: 768px) 160px, 30vw"
              }
              className="object-cover"
            />
          </motion.span>
        </AnimatePresence>
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />
        {style.examples.length > 1 && (
          <span className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1" aria-hidden>
            {style.examples.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1 rounded-full bg-white/80 transition-all duration-300",
                  i === shown ? "w-3.5" : "w-1 opacity-60",
                )}
              />
            ))}
          </span>
        )}
        <AnimatePresence>
          {on && (
            <motion.span
              initial={{ scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 22 }}
              className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shadow-md"
            >
              {order}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="flex flex-col gap-0.5 px-3 py-2.5">
        <span className="text-[13px] font-semibold leading-tight">{style.label}</span>
        <span className="text-[11.5px] leading-snug text-muted-foreground">{style.line}</span>
      </span>
    </motion.button>
  );
}

export function PictureStylePicker({
  value,
  onChange,
  autoIds,
  size = "md",
  className,
}: {
  value: StylePick;
  onChange: (next: StylePick) => void;
  /** What Mox would pick for this brand, shown on the Mox tile. */
  autoIds: readonly PictureStyleId[];
  size?: "md" | "lg";
  className?: string;
}) {
  const reduce = useReducedMotion();
  const own = value.auto ? [] : value.ids;
  const autoStyles = autoIds.map(pictureStyleById).filter((s): s is PictureStyle => !!s);
  return (
    <div className={cn("space-y-3", className)}>
      <motion.button
        type="button"
        aria-pressed={value.auto}
        onClick={() => onChange({ auto: true, ids: [] })}
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        whileTap={{ scale: 0.985 }}
        className={cn(
          "relative flex w-full items-center gap-4 overflow-hidden rounded-[24px] p-3 pr-4 text-left ring-1 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          value.auto
            ? "ring-2 ring-primary shadow-[0_14px_34px_-18px_hsl(var(--primary)/0.9)]"
            : "ring-[var(--ds-tile-border,rgba(0,0,0,0.08))] hover:ring-primary/40",
        )}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(120% 140% at 0% 50%, hsl(var(--primary) / 0.22), transparent 60%)",
          }}
        />
        <span className="relative grid h-16 w-16 shrink-0 place-items-center">
          <Mox pose="face" size={58} shadow={false} float={!reduce} alt="" />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold">Let Mox decide</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">
            Mox picks the styles that suit your brand and rotates them, so every post feels fresh.
          </span>
          {autoStyles.length > 0 && (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {autoStyles.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex h-6 items-center gap-1.5 rounded-full bg-white/80 pl-0.5 pr-2 text-[11px] font-semibold ring-1 ring-black/5 dark:bg-white/10"
                >
                  <span className="relative h-5 w-5 overflow-hidden rounded-full">
                    <Image src={s.examples[0]} alt="" fill sizes="20px" className="object-cover" />
                  </span>
                  {s.label}
                </span>
              ))}
            </span>
          )}
        </span>
        <AnimatePresence>
          {value.auto && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="relative grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
            >
              <Check className="h-3.5 w-3.5" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <div className="flex items-baseline justify-between gap-3 px-1 pt-1">
        <span className="text-[12px] font-semibold text-muted-foreground">
          Or choose up to {MAX_PICTURE_STYLES}
        </span>
        {own.length > 0 && (
          <span className="text-[11.5px] text-muted-foreground">
            {own.length} of {MAX_PICTURE_STYLES} picked
          </span>
        )}
      </div>
      <div
        className={cn(
          "grid gap-2.5",
          size === "lg"
            ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
            : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4",
        )}
      >
        {PICTURE_STYLES.map((s, i) => (
          <StyleTile
            key={s.id}
            style={s}
            index={i}
            size={size}
            order={own.indexOf(s.id) + 1}
            onToggle={() => {
              const ids = toggleStyle(own, s.id);
              onChange(ids.length ? { auto: false, ids } : { auto: true, ids: [] });
            }}
          />
        ))}
      </div>
    </div>
  );
}
