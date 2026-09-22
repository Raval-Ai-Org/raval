"use client";

import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { BarChart3, RefreshCw, X } from "@/components/icons";
import { AnalyticsContent } from "@/components/app/AnalyticsContent";
import { normalizeAnalyticsTab, type AnalyticsTab } from "@/components/app/AnalyticsTabs";
import { AnalyticsMark, SearchConsoleMark } from "@/components/app/analytics/GoogleConnectCard";
import { useGoogleConnection, useSyncNow } from "@/components/app/analytics/hooks";
import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { cn } from "@/lib/utils";

function readTabFromUrl(): AnalyticsTab {
  if (typeof window === "undefined") return "overview";
  return normalizeAnalyticsTab(new URL(window.location.href).searchParams.get("tab")) ?? "overview";
}

function relative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * The connected sources, freshness and a refresh button — the only connection
 * UI left in analytics, and it appears only once something is connected.
 * Choosing, changing or removing a source lives in Settings → Connections.
 */
function StatusStrip() {
  const { data } = useGoogleConnection();
  const sync = useSyncNow();
  if (!data?.connection || data.connection.status !== "active") return null;
  if (!data.ga4 && !data.gsc) return null;
  const busy = [data.ga4?.run, data.gsc?.run].some(
    (r) => r && (r.status === "queued" || r.status === "running"),
  );
  const last = relative(
    [data.ga4?.lastSyncedAt, data.gsc?.lastSyncedAt].filter(Boolean).sort().reverse()[0] ?? null,
  );
  const marks = [
    data.ga4 ? { key: "ga4", Mark: AnalyticsMark, name: data.ga4.displayName } : null,
    data.gsc ? { key: "gsc", Mark: SearchConsoleMark, name: data.gsc.displayName } : null,
  ].filter(Boolean) as Array<{ key: string; Mark: typeof AnalyticsMark; name: string }>;

  return (
    <div className="hidden items-center gap-2 md:flex">
      <div className="flex items-center gap-1.5 rounded-full border border-border/70 bg-card/70 py-1 pl-1.5 pr-2.5">
        <span className="flex -space-x-1.5">
          {marks.map(({ key, Mark, name }) => (
            <span
              key={key}
              title={name}
              className="grid size-5 place-items-center rounded-full bg-white ring-1 ring-border/60"
            >
              <Mark className="size-3.5" />
            </span>
          ))}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {busy ? "Syncing…" : last ? `Updated ${last}` : "Waiting for data"}
        </span>
      </div>
      <button
        type="button"
        aria-label="Refresh data from Google"
        disabled={busy || sync.isPending}
        onClick={() =>
          sync.mutate(undefined, {
            onSuccess: () => toast.success("Refreshing your data from Google"),
            onError: (e) =>
              toast.error(e instanceof Error ? e.message : "Couldn't start the refresh"),
          })
        }
        className="grid size-8 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className={cn("size-3.5", (busy || sync.isPending) && "animate-spin")} />
      </button>
    </div>
  );
}

export function AnalyticsModal({
  open,
  onOpenChange,
  workspaceName,
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

  // "Ask Mellox" puts a question in the chat composer — step aside so it's visible.
  useEffect(() => {
    if (!open) return;
    const close = () => onOpenChange(false);
    addAppEventListener("chat:prefill", close);
    return () => removeAppEventListener("chat:prefill", close);
  }, [open, onOpenChange]);

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
                    Analytics for your workspace from Google Analytics, Google Search Console and
                    Mellox.
                  </DialogPrimitive.Description>
                </VisuallyHidden>

                {/* Soft brand halo */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-0 opacity-70"
                  style={{
                    background:
                      "radial-gradient(60% 50% at 18% 0%, hsl(var(--primary) / 0.08), transparent 60%), radial-gradient(50% 45% at 100% 100%, hsl(var(--brand) / 0.10), transparent 65%)",
                  }}
                />

                {/* Header */}
                <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/70 px-4 py-3 backdrop-blur-xl sm:px-6">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                      <BarChart3 className="h-4 w-4" />
                    </span>
                    <div className="flex min-w-0 items-baseline gap-2">
                      <h2 className="truncate text-[14px] font-semibold tracking-tight">
                        Analytics
                      </h2>
                      {workspaceName && (
                        <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">
                          {workspaceName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <StatusStrip />
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
                <div className="scrollbar-thin relative z-10 min-h-0 flex-1 overflow-y-auto">
                  <AnalyticsContent tab={tab} onTabChange={updateTab} />
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
