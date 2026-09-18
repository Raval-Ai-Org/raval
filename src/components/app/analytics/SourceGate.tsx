"use client";

// SourceGate — shows the right state for a Google source that isn't ready yet
// (not set up, not connected, choose a property/site, first sync, reconnect,
// failed), and the report once it has data.
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/empty-state";
import { Loader2 } from "@/components/icons";
import type { SourceStatus } from "@/lib/analytics/types";
import { GoogleConnectCard } from "./GoogleConnectCard";

export function ReportSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
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

export function SourceGate({
  status,
  children,
}: {
  status: SourceStatus;
  children: React.ReactNode;
}) {
  if (status.state === "ready") return <>{children}</>;
  return (
    <div className="space-y-3">
      {status.state === "syncing" && (
        <div
          className="flex items-center gap-2 rounded-2xl border border-border bg-card/60 p-4 text-[12.5px] text-muted-foreground"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
          Loading your data from Google. This usually takes a minute or two.
        </div>
      )}
      {status.state === "error" && status.message && (
        <p
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3 text-[12.5px] text-destructive"
          role="alert"
        >
          {status.message}
        </p>
      )}
      <GoogleConnectCard />
    </div>
  );
}
