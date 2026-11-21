"use client";

import { useEffect, useState, type Ref } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "@/components/icons";
import { Mox } from "@/components/brand/mox/Mox";
import {
  MAX_PICTURE_STYLES,
  TEMPLATE_STYLES,
  cleanStyleIds,
  toggleStyle,
  type PictureStyle,
} from "@/lib/brand-look/picture-styles";
import type { StylesScreen as Screen } from "@/lib/onboarding/questions";
import { cn } from "@/lib/utils";
import { Highlighted } from "./text";

/** One style: a real Mellox post that shuffles through its examples while hovered. */
function Tile({
  style,
  order,
  index,
  reduce,
  onClick,
}: {
  style: PictureStyle;
  order: number;
  index: number;
  reduce: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!hover || reduce || style.examples.length < 2) return;
    const t = window.setInterval(() => setShown((n) => (n + 1) % style.examples.length), 1000);
    return () => window.clearInterval(t);
  }, [hover, reduce, style.examples.length]);
  const on = order > 0;
  return (
    <motion.button
      type="button"
      aria-pressed={on}
      aria-label={`${style.label}: ${style.line}`}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setShown(0);
      }}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        delay: reduce ? 0 : 0.08 + index * 0.035,
        type: "spring",
        stiffness: 300,
        damping: 24,
      }}
      whileHover={reduce ? undefined : { y: -4 }}
      whileTap={reduce ? undefined : { scale: 0.94 }}
      className={cn(
        "ob-card group relative flex min-h-0 flex-col overflow-hidden rounded-[18px] p-1.5 text-left",
        on && "ob-card-on",
      )}
    >
      <span className="relative block min-h-0 flex-1 overflow-hidden rounded-[13px] bg-muted">
        <AnimatePresence initial={false}>
          <motion.span
            key={shown}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 1.06 }}
            animate={{ opacity: 1, scale: hover && !reduce ? 1.06 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            <Image
              src={style.examples[shown] ?? style.examples[0]}
              alt=""
              fill
              sizes="(min-width: 1024px) 150px, 30vw"
              className="object-cover"
            />
          </motion.span>
        </AnimatePresence>
        <AnimatePresence>
          {on && (
            <motion.span
              initial={{ scale: 0, rotate: -40 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 460, damping: 20 }}
              className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-[10.5px] font-bold text-primary-foreground shadow"
            >
              {order}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="block truncate px-1 pb-0.5 pt-1.5 text-[11.5px] font-semibold text-foreground/85 sm:text-[12.5px]">
        {style.label}
      </span>
    </motion.button>
  );
}

/**
 * How the brand's posts should look: up to three picture styles, or Mox
 * decides (the default and the first tile). Replaces the old swipe deck.
 * Continue lives in the dock.
 */
export function StylesScreen({
  screen,
  value,
  reduce,
  headingRef,
  onChange,
}: {
  screen: Screen;
  /** Picked ids; [] (or unset) means Mox decides. */
  value: string[] | undefined;
  reduce: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onChange: (next: string[]) => void;
}) {
  const own = cleanStyleIds(value);
  const auto = own.length === 0;
  return (
    <div className="flex h-full min-h-0 flex-col items-center">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="ob-title shrink-0 px-2 text-center outline-none"
      >
        <Highlighted text={screen.title} />
      </h1>
      <p className="mt-1.5 shrink-0 px-4 text-center text-[13px] text-muted-foreground sm:text-[14px]">
        {own.length >= MAX_PICTURE_STYLES
          ? `That's ${MAX_PICTURE_STYLES}. Tap another to swap the oldest.`
          : screen.sub}
      </p>
      <div
        role="group"
        aria-label="Picture styles"
        className="mt-4 grid min-h-0 w-full max-w-[920px] flex-1 grid-cols-3 grid-rows-4 gap-2 sm:grid-cols-4 sm:grid-rows-3 sm:gap-2.5 lg:grid-cols-6 lg:grid-rows-2 lg:gap-3"
      >
        <motion.button
          type="button"
          aria-pressed={auto}
          onClick={() => onChange([])}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: reduce ? 0 : 0.05, type: "spring", stiffness: 300, damping: 24 }}
          whileTap={reduce ? undefined : { scale: 0.94 }}
          className={cn(
            "ob-card relative flex min-h-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[18px] p-2 text-center",
            auto && "ob-card-on",
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(90% 80% at 50% 35%, hsl(var(--primary) / 0.28), transparent 70%)",
            }}
          />
          <span className="relative">
            <Mox pose="face" size={64} shadow={false} float={!reduce} alt="" />
          </span>
          <span className="relative text-[12px] font-semibold leading-tight sm:text-[13px]">
            Let Mox decide
          </span>
          <span className="relative hidden text-[10.5px] leading-tight text-muted-foreground sm:block">
            Your site&rsquo;s own look, else the best 3
          </span>
          <span
            aria-hidden
            className={cn(
              "absolute right-2 top-2 grid size-5 place-items-center rounded-full transition-all duration-300",
              auto ? "scale-100 bg-primary text-primary-foreground" : "scale-0",
            )}
          >
            <Check className="size-3" strokeWidth={3} />
          </span>
        </motion.button>
        {TEMPLATE_STYLES.map((s, i) => (
          <Tile
            key={s.id}
            style={s}
            index={i + 1}
            reduce={reduce}
            order={own.indexOf(s.id) + 1}
            onClick={() => onChange(toggleStyle(own, s.id))}
          />
        ))}
      </div>
    </div>
  );
}
