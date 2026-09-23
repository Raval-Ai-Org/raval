"use client";

// Per-source states inside an unlocked analytics surface. Connecting is handled
// once by AnalyticsGate, so nothing here ever asks for a connection again — a
// panel whose own source is missing (only Search Console chosen, say) says so
// quietly and points at Settings.
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/empty-state";
import { Clock, Loader2, Settings } from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import type { SourceStatus } from "@/lib/analytics/types";

export function ReportSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    </div>
  );
}

export function ReportError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <ErrorState
      size="sm"
      className="rounded-2xl border border-border"
      title="That report didn't load"
      detail={error instanceof Error ? error.message : null}
      onRetry={onRetry}
    />
  );
}

const COPY: Record<SourceStatus["state"], { title: string; body: string }> = {
  ready: { title: "", body: "" },
  syncing: {
    title: "Loading your data",
    body: "Mellox is importing your history from Google. This usually takes a minute or two.",
  },
  no_source: {
    title: "Nothing chosen yet",
    body: "Pick the property Mellox should read in Settings → Connections.",
  },
  not_connected: {
    title: "Nothing chosen yet",
    body: "Pick the property Mellox should read in Settings → Connections.",
  },
  not_configured: {
    title: "Not available",
    body: "This source isn't set up on this Mellox server.",
  },
  reconnect: {
    title: "Google access expired",
    body: "Sign in with Google again in Settings → Connections.",
  },
  error: {
    title: "The last sync didn't finish",
    body: "Mellox will try again automatically. You can also retry it in Settings → Connections.",
  },
};

/** The empty/waiting state for one source, shown in place of its report. */
export function SourceNotice({ status }: { status: SourceStatus }) {
  const copy = COPY[status.state];
  const syncing = status.state === "syncing";
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/80 bg-card/40 px-6 py-14 text-center"
    >
      <span className="grid size-10 place-items-center rounded-xl bg-muted/50 text-muted-foreground">
        {syncing ? (
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
        ) : (
          <Clock className="size-4" aria-hidden />
        )}
      </span>
      <h3 className="mt-1 text-[13.5px] font-semibold">{copy.title}</h3>
      <p className="max-w-xs text-[12px] leading-relaxed text-muted-foreground">
        {status.message ?? copy.body}
      </p>
      {!syncing && (
        <button
          type="button"
          onClick={() => emitAppEvent("open:settings", { section: "analytics" })}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-[12px] font-medium transition hover:border-foreground/30"
        >
          <Settings className="size-3.5" aria-hidden /> Open connections
        </button>
      )}
    </div>
  );
}

export function SourceGate({
  status,
  children,
}: {
  status: SourceStatus;
  children: React.ReactNode;
}) {
  if (status.state === "ready") return <>{children}</>;
  return <SourceNotice status={status} />;
}
