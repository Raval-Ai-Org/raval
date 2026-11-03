"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/authed-fetch";
import { emitAppEvent } from "@/lib/app-events";
import { refreshWorkspaceJobs } from "@/lib/studio/session-store";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function StopStudioJobsButton({
  workspaceId,
  compact = false,
  className,
}: {
  workspaceId: string;
  /** A small text button for the Studio panel's header row. */
  compact?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const { data } = useEntitlements();
  if (data?.role === "viewer") return null;
  const stop = async () => {
    setBusy(true);
    try {
      const response = await authedFetch("/api/studio/jobs/cancel-all", {
        method: "POST",
        workspaceId,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error("Could not stop all generations. Try again.");
      await refreshWorkspaceJobs(workspaceId);
      emitAppEvent("content:changed");
      emitAppEvent("billing:changed");
      toast.success(
        `${result.cancelled} pending generation${result.cancelled === 1 ? "" : "s"} stopped`,
        { description: "Their unused credit reservations have been released." },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not stop generations.");
    } finally {
      setBusy(false);
    }
  };
  if (compact)
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => void stop()}
        title="Stop everything being created"
        className={cn(
          "rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-danger-surface hover:text-danger disabled:opacity-50",
          className,
        )}
      >
        {busy ? "Stopping…" : "Stop all"}
      </button>
    );
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => void stop()}
      className={className}
    >
      {busy ? "Stopping…" : "Stop pending Studio generations"}
    </Button>
  );
}
