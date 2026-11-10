"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "@/components/ui/gemini-icons";
import { cn } from "@/lib/utils";
import { closeOnlyFromSidebar, useCanvasHost, useShellWindow } from "@/lib/shell/window";
import { WindowErrorBoundary } from "@/components/ui/window-error-boundary";

type Size = "sm" | "md" | "lg" | "xl" | "2xl";

/** Standard (windowed) sizes. Large surfaces open as a comfortable medium window and can be maximized. */
const SIZE_MAP: Record<Size, string> = {
  // On phones the small windows rise from the bottom as a sheet.
  sm: "w-[calc(100vw-24px)] max-w-[560px] h-auto max-h-[86dvh] max-sm:mx-0 max-sm:mb-0 max-sm:w-screen max-sm:max-w-none max-sm:rounded-b-none max-sm:max-h-[92dvh]",
  md: "w-[calc(100vw-24px)] max-w-[760px] h-auto max-h-[88dvh] max-sm:mx-0 max-sm:mb-0 max-sm:w-screen max-sm:max-w-none max-sm:rounded-b-none max-sm:max-h-[92dvh]",
  lg: "w-[calc(100vw-24px)] max-w-[920px] h-[min(86dvh,860px)] max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none",
  xl: "w-[calc(100vw-24px)] max-w-[1040px] h-[min(88dvh,900px)] max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none",
  "2xl":
    "w-[calc(100vw-24px)] max-w-[1240px] h-[min(92dvh,960px)] max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none",
};

const iconBtn =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ds-well-bg)] text-muted-foreground transition-[background-color,color,transform] duration-300 hover:bg-[var(--ds-well-bg-hover)] active:scale-90 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40 lg:h-8 lg:w-8";

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
  routed = false,
  contentClassName,
  bodyClassName,
  children,
  srDescription,
  navId,
  onBack,
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
  /**
   * The window is a page of its own (/brain, /inspo…). A sidebar press then
   * just navigates and the route unmounts it; closing it here too would send
   * the person Home on top of where they asked to go.
   */
  routed?: boolean;
  contentClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
  srDescription?: string;
  /** The sidebar row this window belongs to (nav.ts id), highlighted while open. */
  navId?: string;
  /**
   * In the canvas, Back steps one level out (a pick inside the window)
   * instead of closing it. Esc does the same. Leave unset at the top level.
   */
  onBack?: () => void;
}) {
  const [maximized, setMaximized] = useState(false);
  // Small windows on a phone are bottom sheets that slide up (see SIZE_MAP).
  const phoneSheet =
    (size === "sm" || size === "md") &&
    !maximized &&
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 639px)").matches;
  const contentRef = useRef<HTMLDivElement>(null);
  const big = size === "lg" || size === "xl" || size === "2xl";
  // Mellox 2.0 (Holo): on a desktop inside the app, a big surface is a screen
  // on the canvas, drawn inside the workspace column. It is not a pop-up:
  // nothing is measured or laid over the page, so it follows the sidebar and
  // never locks the app.
  const host = useCanvasHost(open && big);
  const embed = Boolean(host);
  // One render passes before the canvas is known; nothing is drawn in it.
  const waiting = open && big && host === undefined;
  // A canvas window steps aside when a sidebar row is pressed; a routed one is
  // unmounted by the navigation instead.
  useShellWindow(navId, open, !routed && !disableClose ? () => onOpenChange(false) : undefined);
  // Big workspaces (lg/xl) can become a full page; small forms stay popups.
  const canMaximize = !embed && (allowMaximize ?? big);
  useEffect(() => {
    if (!open) setMaximized(false);
  }, [open]);

  const contentProps = {
    // Focus the window itself, not its first button: otherwise the
    // maximize control opens wearing a focus ring.
    onOpenAutoFocus: (e: Event) => {
      e.preventDefault();
      contentRef.current?.focus({ preventScroll: true });
    },
    onEscapeKeyDown: (e: KeyboardEvent) => {
      if (disableClose) e.preventDefault();
      else if (onBack) {
        e.preventDefault();
        onBack();
      } else if (maximized) {
        // Esc first returns from the full page to the window.
        e.preventDefault();
        setMaximized(false);
      }
    },
    onPointerDownOutside: (e: Event) => {
      if (disableClose || (embed && routed)) e.preventDefault();
      else if (embed) closeOnlyFromSidebar(e);
    },
    onInteractOutside: (e: Event) => {
      if (disableClose || (embed && routed)) e.preventDefault();
      else if (embed) closeOnlyFromSidebar(e);
    },
  };

  const inner = (
    <>
      <VisuallyHidden>
        <DialogPrimitive.Title>
          {typeof title === "string" ? title : "Dialog"}
        </DialogPrimitive.Title>
        {srDescription && (
          <DialogPrimitive.Description>{srDescription}</DialogPrimitive.Description>
        )}
      </VisuallyHidden>

      {!embed && (
        <div
          aria-hidden
          className="ds-aurora pointer-events-none absolute inset-x-0 top-0 h-48 opacity-80"
        />
      )}
      {(size === "sm" || size === "md") && !maximized && (
        <span
          aria-hidden
          className="relative z-10 mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-foreground/15 sm:hidden"
        />
      )}
      {/* Header */}
      <header
        className={cn(
          "relative z-10 flex min-h-16 shrink-0 flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-5",
          !embed && "border-b border-[var(--ds-card-border)]",
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
        {embed && !maximized && !hideClose && onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back one step"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] pl-2.5 pr-3.5 text-[13px] font-semibold shadow-[var(--ds-card-shadow)] transition hover:-translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <BackIcon className="h-4 w-4" /> Back
          </button>
        )}
        {embed && !maximized && !hideClose && !onBack && (
          // In the page (Holo): a Back pill, not a close cross.
          <DialogPrimitive.Close
            aria-label="Close dialog"
            disabled={disableClose}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] pl-2.5 pr-3.5 text-[13px] font-semibold shadow-[var(--ds-card-shadow)] transition hover:-translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40"
          >
            <BackIcon className="h-4 w-4" /> Back
          </DialogPrimitive.Close>
        )}
        {!embed && !maximized && onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back one step"
            title="Back"
            className={iconBtn}
          >
            <BackIcon className="h-4 w-4" />
          </button>
        )}
        {Icon && !embed && !onBack && (
          <span className="ds-grad-pill hidden h-10 w-10 shrink-0 place-items-center rounded-[14px] text-[var(--mox-ink)] shadow-[0_8px_18px_-10px_rgb(46_230_107/0.9)] min-[420px]:grid">
            <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
          </span>
        )}
        <div className={cn("min-w-0 flex-1", embed && "flex justify-center")}>
          <h2
            className={cn(
              "break-words font-bold leading-tight tracking-[-0.02em] text-foreground",
              embed
                ? "truncate rounded-full bg-[var(--ds-well-bg)] px-4 py-1.5 text-[13px] font-semibold"
                : "text-[18px]",
            )}
          >
            {title}
          </h2>
          {description && (
            // Pinterest-style windows show the title only; the line stays for screen readers.
            <div className="sr-only">{description}</div>
          )}
        </div>

        {headerAccessory && (
          <div className="order-last flex w-full min-w-0 flex-wrap items-center gap-1.5 pb-1 @min-[640px]/modal:order-none @min-[640px]/modal:w-auto @min-[640px]/modal:pb-0">
            {headerAccessory}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
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
          {!hideClose && !embed && (
            <DialogPrimitive.Close
              aria-label="Close dialog"
              title="Close (Esc)"
              disabled={disableClose}
              className={cn(iconBtn, "hover:rotate-90")}
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          )}
        </div>
      </header>

      {/* Body */}
      <div
        className={cn(
          "relative z-10 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-thin",
          bodyClassName,
        )}
      >
        <WindowErrorBoundary
          resetKey={open}
          onClose={disableClose ? undefined : () => onOpenChange(false)}
        >
          {children}
        </WindowErrorBoundary>
      </div>
    </>
  );

  return (
    <DialogPrimitive.Root
      open={open}
      // A pop-up only where there is no canvas (phones, small forms).
      modal={!embed}
      onOpenChange={(v) => {
        if (disableClose && !v) return;
        onOpenChange(v);
      }}
    >
      {host ? (
        // On the canvas: part of the page. It arrives with a CSS fade and
        // leaves at once, so a screen is never left half-closed over the next.
        open ? (
          <DialogPrimitive.Portal forceMount container={host}>
            <DialogPrimitive.Content asChild {...contentProps}>
              <div
                ref={contentRef}
                tabIndex={-1}
                data-mellox-app
                data-modal="false"
                data-canvas-window
                className={cn(
                  // `isolate`: each window is its own layer, so the z-10 parts of
                  // a page underneath never paint through a window opened over it.
                  "ds-canvas ds-enter isolate @container/modal absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden outline-none",
                  contentClassName,
                )}
              >
                {inner}
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null
      ) : (
        <AnimatePresence>
          {open && !waiting && (
            <DialogPrimitive.Portal forceMount>
              <DialogPrimitive.Overlay asChild>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                  className="fixed inset-0 z-50 bg-[rgb(22_25_27/0.28)] backdrop-blur-[10px] dark:bg-black/55"
                />
              </DialogPrimitive.Overlay>

              <DialogPrimitive.Content asChild {...contentProps}>
                <motion.div
                  ref={contentRef}
                  tabIndex={-1}
                  data-mellox-app
                  data-modal="true"
                  // Centering lives in the animated transform so the animation never
                  // fights a CSS translate (which caused off-centre popups).
                  // Centred with plain CSS (inset-0 + m-auto); the animation only fades,
                  // lifts 10px and scales a touch — no transform tug-of-war.
                  initial={
                    phoneSheet
                      ? { opacity: 1, scale: 1, y: "100%" }
                      : { opacity: 0, scale: 0.94, y: 18 }
                  }
                  animate={{ opacity: 1, scale: 1, y: 0, x: 0 }}
                  exit={
                    phoneSheet
                      ? { y: "100%", transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }
                      : {
                          opacity: 0,
                          scale: 0.985,
                          y: 6,
                          transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
                        }
                  }
                  // Mellox 2.0: a soft spring, Holo style.
                  transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.8 }}
                  style={{ transformOrigin: "center" }}
                  className={cn(
                    "ds-glow @container/modal fixed inset-0 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--ds-frame-bg)] outline-none transition-[width,height,max-width,max-height,border-radius] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform",
                    maximized
                      ? "m-0 h-dvh w-screen max-w-none rounded-none"
                      : cn(
                          "ds-window m-auto rounded-[var(--ds-pop-radius)] shadow-[var(--ds-pop-shadow)]",
                          SIZE_MAP[size],
                          (size === "sm" || size === "md") && "h-fit",
                        ),
                    contentClassName,
                    maximized && "max-w-none",
                  )}
                >
                  {inner}
                </motion.div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          )}
        </AnimatePresence>
      )}
    </DialogPrimitive.Root>
  );
}
