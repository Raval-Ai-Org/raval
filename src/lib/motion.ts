/**
 * Motion tokens — the TypeScript half of the system defined in `src/styles.css`.
 *
 * The CSS custom properties (`--motion-duration-*`, `--motion-ease-*`) are the
 * source of truth for anything styled in CSS. This module mirrors them for
 * Framer Motion, which needs plain numbers and cubic-bezier arrays.
 *
 * Rule: components never hardcode a duration or an easing curve. Import from
 * here instead, so a change to the system is a change in two files rather than
 * two hundred.
 *
 *   import { duration, ease, fade, slideUp } from "@/lib/motion";
 *   <motion.div {...fade} />
 *   <motion.div transition={{ duration: duration.base, ease: ease.standard }} />
 */

/** Seconds — Framer Motion's unit. Mirrors `--motion-duration-*` (ms). */
export const duration = {
  /** 80ms — press, ripple, anything that must feel instantaneous. */
  instant: 0.08,
  /** 120ms — hover tints, icon swaps. */
  fast: 0.12,
  /** 180ms — the default UI transition. */
  base: 0.18,
  /** 240ms — menus, tooltips, chips, popovers. */
  medium: 0.24,
  /** 320ms — dialogs, sheets, drawers. */
  slow: 0.32,
  /** 480ms — page and route reveals. */
  xslow: 0.48,
} as const;

/** Cubic-bezier control points. Mirrors `--motion-ease-*`. */
export const ease = {
  /** Most UI. Quick departure, gentle settle. */
  standard: [0.2, 0.7, 0.2, 1],
  /** Entrances and anything that should feel confident. */
  emphasized: [0.22, 1, 0.36, 1],
  /** Elements entering the screen. */
  decelerate: [0, 0, 0.2, 1],
  /** Elements leaving the screen. */
  accelerate: [0.4, 0, 1, 1],
  /** Playful pops only — never for routine UI. */
  spring: [0.34, 1.56, 0.64, 1],
} as const;

/** Physical spring for surfaces that should feel grabbed rather than timed. */
export const spring = {
  /** Dialogs and sheets. */
  surface: { type: "spring", stiffness: 280, damping: 30, mass: 0.9 },
  /** Small controls — chips, toggles, badges. */
  control: { type: "spring", stiffness: 420, damping: 32, mass: 0.6 },
} as const;

type Transition = { duration: number; ease: readonly number[] };

const t = (d: number, e: readonly number[] = ease.standard): Transition => ({
  duration: d,
  ease: e,
});

/** Named transitions for `transition={...}`. */
export const transition = {
  instant: t(duration.instant),
  fast: t(duration.fast),
  base: t(duration.base),
  medium: t(duration.medium),
  slow: t(duration.slow, ease.emphasized),
  enter: t(duration.medium, ease.decelerate),
  exit: t(duration.fast, ease.accelerate),
} as const;

/* ── Ready-made variants ─────────────────────────────────────────────────
   Spread these onto a motion element: <motion.div {...fade} />          */

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: transition.base,
} as const;

export const slideUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: transition.medium,
} as const;

export const scaleIn = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
  transition: transition.medium,
} as const;

/** Dialog content. Pair with `fade` on the overlay. */
export const dialogContent = {
  initial: { opacity: 0, scale: 0.97, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: 6 },
  transition: spring.surface,
} as const;

/** Bottom sheet on small viewports. */
export const sheetUp = {
  initial: { y: "100%" },
  animate: { y: 0 },
  exit: { y: "100%" },
  transition: transition.slow,
} as const;

/**
 * Stagger a list. Put `stagger` on the parent and `staggerItem` on each child.
 * Keep lists short — past ~8 items the last one arrives late enough to notice.
 */
export const stagger = {
  initial: "hidden",
  animate: "show",
  variants: {
    hidden: {},
    show: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
  },
} as const;

export const staggerItem = {
  variants: {
    hidden: { opacity: 0, y: 6 },
    show: { opacity: 1, y: 0, transition: transition.medium },
  },
} as const;

/**
 * Collapse any variant set to a plain cross-fade. Call with the result of
 * `useReducedMotion()` — CSS media queries do not reach Framer Motion, so
 * every animated component has to opt in explicitly.
 *
 *   const reduce = useReducedMotion();
 *   <motion.div {...reduceMotion(slideUp, reduce)} />
 */
export function reduceMotion<T extends { initial?: unknown; animate?: unknown; exit?: unknown }>(
  variant: T,
  reduce: boolean | null,
): T | typeof fadeFast {
  return reduce ? fadeFast : variant;
}

const fadeFast = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: transition.fast,
} as const;
