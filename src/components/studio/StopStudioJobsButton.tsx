"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/authed-fetch";
import { emitAppEvent } from "@/lib/app-events";
import { refreshWorkspaceJobs } from "@/lib/studio/session-store";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { toast } from "@/lib/toast";

export function StopStudioJobsButton({ workspaceId }: { workspaceId: string }) {
  const [busy, setBusy] = useState(false);
  const { data } = useEntitlements();
  if (data?.role === "viewer") return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
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
      }}
    >
      {busy ? "Stopping…" : "Stop pending Studio generations"}
    </Button>
  );
}
