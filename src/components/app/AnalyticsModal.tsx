"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BarChart3, RefreshCw } from "@/components/icons";
import { AppModalShell } from "@/components/app/AppModalShell";
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
      <div className="flex items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] py-1 pl-1.5 pr-2.5">
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
    <AppModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="2xl"
      Icon={BarChart3}
      title="Analytics"
      description={workspaceName}
      headerAccessory={<StatusStrip />}
      srDescription="Analytics for your workspace from Google Analytics, Google Search Console and Mellox."
      bodyClassName="overflow-hidden"
    >
      <AnalyticsContent tab={tab} onTabChange={updateTab} />
    </AppModalShell>
  );
}
