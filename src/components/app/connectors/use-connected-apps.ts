"use client";

// Which Composio apps (ADR-0042) this workspace has working, for the places
// that offer one of their actions: the calendar's "Google Sheets" export and a
// post's "Save as an email draft". One cached read per workspace; a failed
// read means "nothing connected", so the action is simply not offered.
import { useQuery } from "@tanstack/react-query";
import { getIntegrations } from "@/lib/integrations.functions";

export const connectedAppsKey = (workspaceId: string) => ["integrations", workspaceId] as const;

export function useConnectedApps(workspaceId: string | null | undefined) {
  const query = useQuery({
    queryKey: connectedAppsKey(workspaceId ?? "none"),
    queryFn: () => getIntegrations({ data: { workspaceId: workspaceId! } }),
    enabled: !!workspaceId,
    staleTime: 60_000,
    retry: false,
  });
  const view = query.data;
  const active = new Set(
    (view?.accounts ?? []).filter((a) => a.status === "active").map((a) => a.app),
  );
  return {
    /** The app is connected and working. */
    has: (app: string) => active.has(app),
    /** Apps in testing can be offered to connect (FEATURE_FLAG_INTEGRATIONS_TESTING). */
    canConnect: !!view?.enabled && !!view.configured && !!view.testing,
  };
}
