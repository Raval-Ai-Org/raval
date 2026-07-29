import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, X, BarChart3 } from "@/components/ui/gemini-icons";
import { AnalyticsContent } from "@/components/app/AnalyticsContent";
import { TABS, type AnalyticsTab } from "@/components/app/AnalyticsTabs";

const VALID = new Set(TABS.map((t) => t.id));

function readTabFromUrl(): AnalyticsTab {
  if (typeof window === "undefined") return "overview";
  const t = new URL(window.location.href).searchParams.get("tab");
  return t && VALID.has(t as AnalyticsTab) ? (t as AnalyticsTab) : "overview";
}

export function AnalyticsModal({
  open, onOpenChange, workspaceName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceName?: string;
}) {
  const [tab, setTab] = useState<AnalyticsTab>("overview");

  // On open transition: read tab from URL. We deliberately do NOT strip the
  // URL in a cleanup — the parent controls conditional mounting and Suspense
  // may re-mount this component while `open` stays true, which would race a
  // cleanup-based strip against the initial URL read.
  useEffect(() => {
    if (open) setTab(readTabFromUrl());
  }, [open]);




  const updateTab = (t: AnalyticsTab) => {
    setTab(t);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", t);
      window.history.replaceState({}, "", url.pathname + "?" + url.searchParams.toString());
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
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

            <DialogPrimitive.Content asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 14 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ type: "spring", stiffness: 280, damping: 28, mass: 0.9 }}
                className="fixed left-1/2 top-1/2 z-50 flex h-[92vh] w-[96vw] max-w-[1280px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[1.75rem] border border-border/70 bg-background shadow-[0_30px_120px_-20px_rgba(0,0,0,0.45),0_1px_0_0_hsl(var(--border)),inset_0_1px_0_hsl(0_0%_100%/0.06)]"
              >
                <VisuallyHidden>
                  <DialogPrimitive.Title>Analytics</DialogPrimitive.Title>
                  <DialogPrimitive.Description>
                    Full-screen analytics dashboard for your workspace.
                  </DialogPrimitive.Description>
                </VisuallyHidden>

                {/* Soft brand halo */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-0 opacity-70"
                  style={{
                    background:
                      "radial-gradient(60% 50% at 18% 0%, hsl(var(--brand-blue) / 0.10), transparent 60%), radial-gradient(50% 45% at 100% 100%, hsl(var(--brand-green) / 0.12), transparent 65%)",
                  }}
                />

                {/* Header */}
                <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/70 px-4 py-3 backdrop-blur-xl sm:px-6">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-[hsl(var(--brand-blue)/0.25)] to-[hsl(var(--brand-green)/0.25)] ring-1 ring-border/60">
                      <BarChart3 className="h-4 w-4 text-foreground/80" strokeWidth={2.2} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-[14px] font-semibold tracking-tight">Analytics</h2>
                        {workspaceName && (
                          <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">
                            · {workspaceName}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Activity className="h-3 w-3 text-aura" />
                        Last 30 days · auto-updated
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <kbd className="hidden rounded border border-border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-block">
                      Esc
                    </kbd>
                    <DialogPrimitive.Close
                      aria-label="Close analytics"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </DialogPrimitive.Close>
                  </div>
                </header>

                {/* Body */}
                <div className="relative z-10 min-h-0 flex-1 overflow-y-auto scrollbar-thin">
                  <AnalyticsContent tab={tab} onTabChange={updateTab} showHeader={false} />
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
