"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "@/components/ui/gemini-icons";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | "xl" | "2xl";

/** Standard (windowed) sizes. Large surfaces open as a comfortable medium window and can be maximized. */
const SIZE_MAP: Record<Size, string> = {
  sm: "w-[calc(100vw-24px)] max-w-[560px] h-auto max-h-[86dvh]",
  md: "w-[calc(100vw-24px)] max-w-[760px] h-auto max-h-[88dvh]",
  lg: "w-[calc(100vw-24px)] max-w-[920px] h-[min(86dvh,860px)] max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none",
  xl: "w-[calc(100vw-24px)] max-w-[1040px] h-[min(88dvh,900px)] max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none",
  "2xl":
    "w-[calc(100vw-24px)] max-w-[1240px] h-[min(92dvh,960px)] max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none",
};

const iconBtn =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg-hover)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40";

function MaximizeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}
function RestoreIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
  );
}
function BackIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

/**
 * AppModalShell — unified modal used by every main popup in the app.
 * Two modes: a centred standard window, and a full page (maximize) with a
 * back arrow that returns to the window. Header: icon + title + description
 * on the left, actions on the right — never overlapping.
 */
export function AppModalShell({
  open,
  onOpenChange,
  title,
  description,
  Icon,
  headerAccessory,
  size = "md",
  hideClose = false,
  disableClose = false,
  allowMaximize,
  contentClassName,
  bodyClassName,
  children,
  srDescription,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  Icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  headerAccessory?: ReactNode;
  size?: Size;
  hideClose?: boolean;
  disableClose?: boolean;
  /** Show the maximize / restore control (default on). */
  allowMaximize?: boolean;
  contentClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
  srDescription?: string;
}) {
  const [maximized, setMaximized] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  // Big workspaces (lg/xl) can become a full page; small forms stay popups.
  const canMaximize = allowMaximize ?? (size === "lg" || size === "xl" || size === "2xl");
  useEffect(() => {
    if (!open) setMaximized(false);
  }, [open]);

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
                transition={{ duration: 0.22, ease: "easeOut" }}
                className="fixed inset-0 z-50 bg-black/40 backdrop-blur-md"
              />
            </DialogPrimitive.Overlay>

            <DialogPrimitive.Content
              asChild
              // Focus the window itself, not its first button: otherwise the
              // maximize control opens wearing a focus ring.
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                contentRef.current?.focus({ preventScroll: true });
              }}
              onEscapeKeyDown={(e) => {
                if (disableClose) e.preventDefault();
                else if (maximized) {
                  // Esc first returns from the full page to the window.
                  e.preventDefault();
                  setMaximized(false);
                }
              }}
              onPointerDownOutside={(e) => {
                if (disableClose) e.preventDefault();
              }}
              onInteractOutside={(e) => {
                if (disableClose) e.preventDefault();
              }}
            >
              <motion.div
                ref={contentRef}
                tabIndex={-1}
                data-mellox-app
                // Centering lives in the animated transform so the animation never
                // fights a CSS translate (which caused off-centre popups).
                // Centred with plain CSS (inset-0 + m-auto); the animation only fades,
                // lifts 10px and scales a touch — no transform tug-of-war.
                initial={{ opacity: 0, scale: 0.985, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{
                  opacity: 0,
                  scale: 0.985,
                  y: 6,
                  transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
                }}
                transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                style={{ transformOrigin: "center" }}
                className={cn(
                  "ds-glow fixed inset-0 z-50 flex flex-col overflow-hidden bg-background outline-none transition-[width,height,max-width,max-height,border-radius] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform",
                  maximized
                    ? "m-0 h-dvh w-screen max-w-none rounded-none"
                    : cn(
                        "ds-window m-auto",
                        SIZE_MAP[size],
                        (size === "sm" || size === "md") && "h-fit",
                      ),
                  contentClassName,
                  maximized && "max-w-none",
                )}
              >
                <VisuallyHidden>
                  <DialogPrimitive.Title>
                    {typeof title === "string" ? title : "Dialog"}
                  </DialogPrimitive.Title>
                  {srDescription && (
                    <DialogPrimitive.Description>{srDescription}</DialogPrimitive.Description>
                  )}
                </VisuallyHidden>

                {/* Header */}
                <header
                  className={cn(
                    "relative z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border/50 bg-background/60 px-3 backdrop-blur-xl sm:gap-3 sm:px-5",
                    maximized && "sm:px-8",
                  )}
                >
                  {maximized && (
                    <button
                      type="button"
                      onClick={() => setMaximized(false)}
                      aria-label="Back to window"
                      title="Back"
                      className={iconBtn}
                    >
                      <BackIcon className="h-4 w-4" />
                    </button>
                  )}
                  {Icon && (
                    <span className="hidden h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/12 text-primary ring-1 ring-primary/20 min-[420px]:grid">
                      <Icon className="h-4 w-4" strokeWidth={2.2} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-foreground">
                      {title}
                    </h2>
                    {description && (
                      <div className="hidden truncate text-[11.5px] leading-snug text-muted-foreground sm:block">
                        {description}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {headerAccessory && (
                      <div className="flex min-w-0 items-center gap-1.5">{headerAccessory}</div>
                    )}
                    {canMaximize && (
                      <button
                        type="button"
                        onClick={() => setMaximized((m) => !m)}
                        aria-label={maximized ? "Restore to window" : "Maximize to full page"}
                        title={maximized ? "Restore" : "Maximize"}
                        className={iconBtn}
                      >
                        {maximized ? (
                          <RestoreIcon className="h-4 w-4" />
                        ) : (
                          <MaximizeIcon className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    {!hideClose && (
                      <DialogPrimitive.Close
                        aria-label="Close dialog"
                        title="Close (Esc)"
                        disabled={disableClose}
                        className={iconBtn}
                      >
                        <X className="h-4 w-4" />
                      </DialogPrimitive.Close>
                    )}
                  </div>
                </header>

                {/* Body */}
                <div
                  className={cn(
                    "relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin",
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
