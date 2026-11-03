"use client";

// The workspace pulse in the browser: one free read of what waits for a
// person and what is running (src/lib/pulse/pulse.ts). Keyed by workspace,
// so a switch never shows another brand's pulse.
import { useQuery } from "@tanstack/react-query";
import { getWorkspacePulse } from "@/lib/pulse.functions";

export const pulseKeys = {
  all: (workspaceId: string) => ["pulse", workspaceId] as const,
};

export function useWorkspacePulse(workspaceId: string) {
  return useQuery({
    queryKey: pulseKeys.all(workspaceId),
    staleTime: 60_000,
    retry: false,
    refetchInterval: 120_000,
    refetchOnWindowFocus: true,
    queryFn: () => getWorkspacePulse({ data: { workspaceId } }),
  });
}
