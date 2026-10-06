"use client";
// What the calendar needs to know about Autopilot, read with the same query
// keys as the Autopilot surface so the two never show different plans.
// Reading only: nothing here starts, plans or spends.
import { useQuery } from "@tanstack/react-query";
import { getAutopilot, getAutopilotStatus } from "@/lib/autopilot.functions";
import { autopilotKeys } from "@/components/app/autopilot/hooks";

export function useCalendarAutopilot(workspaceId: string | null, open: boolean) {
  const enabled = open && !!workspaceId;
  const status = useQuery({
    queryKey: autopilotKeys.status(workspaceId),
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: () => getAutopilotStatus({ data: { workspaceId: workspaceId as string } }),
  });
  const live =
    status.data?.enabled === true &&
    (status.data.status === "running" || status.data.status === "paused");

  const view = useQuery({
    queryKey: autopilotKeys.view(workspaceId),
    enabled: enabled && live,
    staleTime: 10_000,
    retry: false,
    queryFn: () => getAutopilot({ data: { workspaceId: workspaceId as string } }),
    // Autopilot moves by itself: look often while it is making something.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data?.program || data.program.status !== "running") return false;
      return data.upcoming.some((a) => a.status === "generating" || a.status === "approved")
        ? 5_000
        : 30_000;
    },
  });

  return {
    /** Autopilot exists for this workspace (it may still be off). */
    available: status.data?.enabled === true,
    /** The live program's view, or null when Autopilot is off or not set up. */
    view: live && view.data?.program ? view.data : null,
  };
}
