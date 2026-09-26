"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { onAppEvent } from "@/lib/app-events";
import { authedFetch } from "@/lib/authed-fetch";
import type { Entitlements } from "@/server/billing/entitlements.server";

export type BillingView = Omit<Entitlements, "accountId" | "ownerUserId"> & {
  accountId: string | null;
  ownerUserId: string | null;
};

export function useEntitlements() {
  const workspaceId = useOptionalWorkspaceId();
  const queryClient = useQueryClient();
  const key = useMemo(() => ["billing", "entitlements", workspaceId ?? "own"], [workspaceId]);
  const query = useQuery<BillingView>({
    queryKey: key,
    queryFn: async () => {
      const params = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
      const response = await authedFetch(`/api/billing/entitlements${params}`, { workspaceId });
      if (!response.ok) throw new Error("Couldn't load your plan and balance.");
      return response.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  useEffect(
    () =>
      onAppEvent("billing:changed", (event) => {
        const balance = event.detail?.balance;
        if (typeof balance === "number" && Number.isFinite(balance)) {
          queryClient.setQueryData<BillingView>(key, (old) =>
            old
              ? {
                  ...old,
                  meters: { ...old.meters, credits: { ...old.meters.credits, available: balance } },
                }
              : old,
          );
        }
        void queryClient.invalidateQueries({ queryKey: key });
      }),
    [queryClient, key],
  );
  return query;
}
