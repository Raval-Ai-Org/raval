"use client";

import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "@/components/ui/gemini-icons";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | "xl";

const SIZE_MAP: Record<Size, string> = {
  sm: "max-w-[560px] h-auto max-h-[86vh] w-[92vw]",
  md: "max-w-[760px] h-auto max-h-[88vh] w-[94vw]",
  lg: "max-w-[1040px] h-[90vh] w-[95vw]",
  xl: "max-w-[1280px] h-[92vh] w-[96vw]",
};

/**
 * AppModalShell — unified modal used by every main popup in the app.
 * Matches the Analytics / Competitor Watch shell: blurred backdrop, brand
 * halo, floating close button, header with icon + title + description,
 * and a scrollable body region.
 */
export function AppModalShell({
  open,
  onOpenChange,
  title,
  description,
  eyebrow,
  Icon,
  headerAccessory,
  size = "md",
  hideClose = false,
  disableClose = false,
  contentClassName,
  bodyClassName,
  children,
  srDescription,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  Icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  headerAccessory?: ReactNode;
  size?: Size;
  hideClose?: boolean;
  disableClose?: boolean;
  contentClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
  srDescription?: string;
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(v) => {
        if (disableClose && !v) return;
        onOpenChange(v);
      }}
    >
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-xl"
              />
            </DialogPrimitive.Overlay>

            <DialogPrimitive.Content
              asChild
              onEscapeKeyDown={(e) => {
                if (disableClose) e.preventDefault();
              }}
              onPointerDownOutside={(e) => {
                if (disableClose) e.preventDefault();
              }}
              onInteractOutside={(e) => {
                if (disableClose) e.preventDefault();
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 14 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ type: "spring", stiffness: 280, damping: 28, mass: 0.9 }}
                className={cn(
                  "fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-background shadow-[0_30px_120px_-20px_rgba(0,0,0,0.45),0_1px_0_0_hsl(var(--border)),inset_0_1px_0_hsl(0_0%_100%/0.06)]",
                  SIZE_MAP[size],
                  contentClassName,
                )}
              >
                {typeof title === "string" ? (
                  <VisuallyHidden>
                    <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
                    {srDescription && (
                      <DialogPrimitive.Description>{srDescription}</DialogPrimitive.Description>
                    )}
                  </VisuallyHidden>
                ) : (
                  <VisuallyHidden>
                    <DialogPrimitive.Title>Dialog</DialogPrimitive.Title>
                    {srDescription && (
                      <DialogPrimitive.Description>{srDescription}</DialogPrimitive.Description>
                    )}
                  </VisuallyHidden>
                )}

                {/* Brand halo */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-0 opacity-70"
                  style={{
                    background:
                      "radial-gradient(60% 50% at 18% 0%, hsl(var(--brand-blue) / 0.10), transparent 60%), radial-gradient(50% 45% at 100% 100%, hsl(var(--brand-green) / 0.12), transparent 65%)",
                  }}
                />

                {/* Header */}
                <header className="relative z-10 flex shrink-0 items-start justify-between gap-3 border-b border-border/70 bg-background/70 px-4 py-3 backdrop-blur-xl sm:px-6">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    {Icon && (
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[hsl(var(--brand-blue)/0.25)] to-[hsl(var(--brand-green)/0.25)] ring-1 ring-border/60">
                        <Icon className="h-4 w-4 text-foreground/80" strokeWidth={2.2} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      {eyebrow && (
                        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          {eyebrow}
                        </div>
                      )}
                      <h2 className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                        {title}
                      </h2>
                      {description && (
                        <div className="mt-0.5 truncate text-[11.5px] leading-snug text-muted-foreground">
                          {description}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {headerAccessory}
                    {!hideClose && (
                      <>
                        <kbd className="hidden rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-block">
                          Esc
                        </kbd>
                        <DialogPrimitive.Close
                          aria-label="Close dialog"
                          disabled={disableClose}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-40"
                        >
                          <X className="h-4 w-4" />
                        </DialogPrimitive.Close>
                      </>
                    )}
                  </div>
                </header>

                {/* Body */}
                <div
                  className={cn(
                    "relative z-10 min-h-0 flex-1 overflow-y-auto scrollbar-thin",
                    bodyClassName,
                  )}
                >
                  {children}
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
