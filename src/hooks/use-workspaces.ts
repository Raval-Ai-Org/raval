"use client";

// The signed-in user's workspaces, from the one shared service
// (workspace_overview → listWorkspaces). Projects, Agency HQ, the sidebar
// switcher and the header menu all read this — none query `workspaces` on
// their own, so lists, names, logos and counts agree everywhere.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { listWorkspaces } from "@/lib/workspaces.functions";
import type { WorkspaceSummary } from "@/server/workspaces/service.server";

export type { WorkspaceSummary };

export const WORKSPACES_QUERY_KEY = ["account", "workspaces"] as const;

export function useWorkspaces(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: ({ signal }) => listWorkspaces({ signal }),
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useInvalidateWorkspaces() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
    [queryClient],
  );
}

export function workspaceLabel(w: Pick<WorkspaceSummary, "domain" | "name">): string {
  return w.domain || w.name || "Workspace";
}
