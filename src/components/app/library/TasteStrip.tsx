"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Heart, MoreHorizontal, RotateCcw } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TasteSummary } from "@/lib/taste/contracts";
import { cn } from "@/lib/utils";

/**
 * "Your taste": what Mellox has learned from the brand's hearts, in a few
 * words. Only learned choices (two posts agree) appear; nothing is guessed.
 */
export function TasteStrip({
  summary,
  onShowLoved,
  onReset,
}: {
  summary: TasteSummary;
  onShowLoved: () => void;
  onReset?: () => void;
}) {
  const liked = summary.chips.filter((c) => c.tone === "liked");
  const avoided = summary.chips.filter((c) => c.tone === "avoided");
  const hint =
    summary.loves === 0
      ? "Tap ♥ on posts you love. Mellox makes more like them."
      : liked.length || avoided.length
        ? null
        : summary.loves < 2
          ? "Love one more to start learning."
          : "Keep going. Mellox learns once two posts agree.";

  return (
    <div
      data-testid="library-taste"
      className="ds-enter relative flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 overflow-hidden rounded-[20px] bg-[linear-gradient(110deg,hsl(var(--primary)/0.14),hsl(var(--primary)/0.04)_45%,transparent)] px-3 py-2.5 ring-1 ring-primary/20"
    >
      <button
        type="button"
        onClick={onShowLoved}
        className="flex shrink-0 items-center gap-2 rounded-full pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        aria-label={`Show ${summary.loves} loved`}
      >
        <span className="relative grid size-9 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_18px_-6px_hsl(var(--primary)/0.9)]">
          <Heart className="size-4 fill-current" />
          <AnimatePresence>
            <motion.span
              key={summary.loves}
              initial={{ scale: 0.6, opacity: 0.7 }}
              animate={{ scale: 1.8, opacity: 0 }}
              transition={{ duration: 0.7 }}
              className="absolute inset-0 rounded-full ring-2 ring-primary"
              aria-hidden
            />
          </AnimatePresence>
        </span>
        <span className="leading-tight">
          <span className="block text-[13px] font-semibold text-foreground">Your taste</span>
          <span className="block text-[11px] tabular-nums text-muted-foreground">
            {summary.loves} loved
          </span>
        </span>
      </button>

      <div className="order-last flex min-w-0 basis-full items-center gap-1.5 overflow-x-auto [scrollbar-width:none]! [&::-webkit-scrollbar]:hidden @xl/library:order-none @xl/library:basis-auto @xl/library:flex-1">
        {hint ? (
          <span className="truncate text-xs text-muted-foreground">{hint}</span>
        ) : (
          <>
            {liked.map((c, i) => (
              <motion.span
                key={`${c.kind}:${c.value}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-background/80 px-2.5 text-[11px] font-medium text-foreground ring-1 ring-primary/30"
              >
                <Heart className="size-3 fill-primary text-primary" />
                {c.label}
              </motion.span>
            ))}
            {avoided.length ? (
              <span className="ml-1 shrink-0 text-[11px] text-muted-foreground">Less:</span>
            ) : null}
            {avoided.map((c) => (
              <span
                key={`${c.kind}:${c.value}`}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center rounded-full bg-surface-2 px-2.5 text-[11px] text-muted-foreground ring-1 ring-border/70",
                )}
              >
                {c.label}
              </span>
            ))}
          </>
        )}
      </div>

      {onReset && (summary.loves || summary.lesses) ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Taste options"
              className="ml-auto grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="rounded-2xl p-1.5">
            <DropdownMenuItem
              className="gap-2 rounded-xl px-2.5 py-2"
              onSelect={() => {
                if (window.confirm("Forget every heart and start over?")) onReset();
              }}
            >
              <RotateCcw className="size-4" />
              Start over
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
