"use client";
// BrainMark — the four brains' real logos (the brand kit SVGs in
// public/brains), tinted with the brain's colour through a mask so a caller
// can still recolour one. They pop in, and pulse softly while a brain has
// something new. Reduced motion draws them still.
import { motion } from "framer-motion";
import { BRAINS, BRAIN_META, type BrainId } from "@/lib/brain/brain";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import { cn } from "@/lib/utils";

/** The brand kit's own brain logos (public/brains), never redrawn. */
const LOGO: Record<BrainId, string> = {
  brand: "/brains/brand.svg",
  audience: "/brains/customer.svg",
  competitors: "/brains/competitor.svg",
  market: "/brains/market.svg",
};

export function BrainMark({
  brain,
  size = 24,
  active = false,
  muted = false,
  delay = 0,
  className,
  color,
}: {
  brain: BrainId;
  size?: number;
  /** Something new here: the cells ripple. */
  active?: boolean;
  /** Nothing in this brain yet: drawn faint. */
  muted?: boolean;
  /** Seconds before the cells start arriving. */
  delay?: number;
  className?: string;
  /** Override the brain's own colour (e.g. `currentColor`). */
  color?: string;
}) {
  const reduce = useReducedMotionSafe();
  const url = `url(${LOGO[brain]})`;
  return (
    <motion.span
      aria-hidden
      className={cn(
        "inline-block shrink-0 transition-opacity duration-300",
        muted && "opacity-35",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: color ?? BRAIN_META[brain].color,
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
      initial={reduce ? false : { opacity: 0, scale: 0.6 }}
      animate={
        active && !reduce
          ? { opacity: [1, 0.55, 1], scale: [1, 0.86, 1] }
          : { opacity: 1, scale: 1 }
      }
      transition={
        active && !reduce
          ? { duration: 1.6, repeat: Infinity, repeatDelay: 1.2, delay, ease: "easeInOut" }
          : { duration: 0.35, delay, ease: [0.16, 1, 0.3, 1] }
      }
    />
  );
}

/**
 * The Brain itself: the four marks in a 2×2. Used as the section's icon in the
 * sidebar, the window header and the Coach pill. `news` lights up the marks
 * that have something new.
 */
export function BrainIcon({
  className,
  size,
  news,
}: {
  className?: string;
  size?: number;
  /** strokeWidth is accepted (and ignored) so this fits anywhere an icon does. */
  strokeWidth?: number;
  news?: Partial<Record<BrainId, number>>;
}) {
  const px = size ?? 18;
  const cell = Math.floor((px - 2) / 2);
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 grid-cols-2 place-items-center gap-[2px]", className)}
      style={size ? { width: px, height: px } : undefined}
    >
      {BRAINS.map((brain, i) => (
        <BrainMark
          key={brain}
          brain={brain}
          size={size ? cell : 8}
          delay={i * 0.06}
          active={!!news?.[brain]}
        />
      ))}
    </span>
  );
}
