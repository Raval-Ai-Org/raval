// Pill button styles for Mellox surfaces — the one definition that AI
// Visibility, Backlinks, Competitors and every other popup share. Sizes are
// left to the call site (`h-9 px-4 text-[13px]`); colour, shape and motion live
// here. Use `<Button>` from @/components/ui/button where a component fits
// better; in the app it renders as the same pill.

import { cn } from "@/lib/utils";

export const dsFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background";

/** The main action on a screen: lime, with a soft lime glow. */
export const dsPrimaryBtn = cn(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-primary font-semibold text-primary-foreground",
  "shadow-[0_6px_20px_-8px_hsl(var(--primary)/0.7)] transition-all duration-200",
  "hover:-translate-y-px hover:bg-primary/90 hover:shadow-[0_10px_28px_-10px_hsl(var(--primary)/0.8)]",
  "active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  dsFocus,
);

/** Everything else that is a button: a quiet outlined pill. */
export const dsGhostBtn = cn(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-border/70 bg-card/80 font-medium text-foreground/85 backdrop-blur",
  "transition-all duration-200 hover:border-foreground/20 hover:bg-secondary hover:text-foreground",
  "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  dsFocus,
);

/** Icon-only round button (toolbar, card corner). */
export const dsIconBtn = cn(
  "grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors",
  "hover:bg-[var(--ds-well-bg-hover)] hover:text-foreground disabled:opacity-40",
  dsFocus,
);
