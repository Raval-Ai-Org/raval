"use client";
// Query keys and mutations for Brain and its Strategy.
//
// Every key carries the workspace id, so the workspace provider drops them all
// on a switch and one brand's brain can never render under another.
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { emitAppEvent, onAppEvent } from "@/lib/app-events";
import { getBrainOverview } from "@/lib/brain.functions";
import { newsSince, type BrainOverview } from "@/lib/brain/brain";
import { generateStrategy, getStrategy, saveStrategy } from "@/lib/strategy.functions";
import type { MarketingStrategy } from "@/lib/strategy/contracts";

export const brainKeys = {
  all: (ws: string | null) => ["brain", ws] as const,
  overview: (ws: string | null) => ["brain", ws, "overview"] as const,
  strategy: (ws: string | null) => ["brain", ws, "strategy"] as const,
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** What every brain holds and what changed. Free to call; refreshed quietly. */
export function useBrainOverview(workspaceId: string | null) {
  const client = useQueryClient();
  // Anything that changes a brain makes the overview worth another look.
  useEffect(() => {
    if (!workspaceId) return;
    return onAppEvent(
      "brand-dna:saved",
      () => void client.invalidateQueries({ queryKey: brainKeys.overview(workspaceId) }),
    );
  }, [client, workspaceId]);
  return useQuery({
    queryKey: brainKeys.overview(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    queryFn: () => getBrainOverview({ data: { workspaceId: workspaceId! } }),
  });
}

const SEEN_KEY = (ws: string) => `brain:seen:${ws}`;

/**
 * When this person last looked at the updates, kept in this browser. It only
 * decides which marks glow; nothing depends on it.
 */
export function useBrainSeen(workspaceId: string | null, overview: BrainOverview | undefined) {
  const [seenAt, setSeenAt] = useState<number | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    try {
      const raw = localStorage.getItem(SEEN_KEY(workspaceId));
      setSeenAt(raw ? Number(raw) || null : null);
    } catch {
      setSeenAt(null);
    }
    // The pill, the sidebar and the Brain window each hold this; one reading it
    // clears the count in all of them.
    return onAppEvent("brain:seen", (event) => {
      if (event.detail.workspaceId === workspaceId) setSeenAt(event.detail.at);
    });
  }, [workspaceId]);
  const markSeen = useCallback(() => {
    if (!workspaceId) return;
    const now = Date.now();
    setSeenAt(now);
    try {
      localStorage.setItem(SEEN_KEY(workspaceId), String(now));
    } catch {
      /* private browsing: the marks just keep glowing */
    }
    emitAppEvent("brain:seen", { workspaceId, at: now });
  }, [workspaceId]);
  const news = newsSince(overview?.updates ?? [], seenAt);
  const total = Object.values(news).reduce((a, b) => a + b, 0);
  return { news, total, seenAt, markSeen };
}

export function useStrategy(workspaceId: string | null) {
  return useQuery({
    queryKey: brainKeys.strategy(workspaceId),
    enabled: !!workspaceId,
    staleTime: 30_000,
    queryFn: () => getStrategy({ data: { workspaceId: workspaceId! } }),
  });
}

export function useStrategyActions(workspaceId: string) {
  const client = useQueryClient();
  const settle = (view: Awaited<ReturnType<typeof getStrategy>>) => {
    client.setQueryData(brainKeys.strategy(workspaceId), view);
    void client.invalidateQueries({ queryKey: brainKeys.overview(workspaceId) });
  };
  const generate = useMutation({
    mutationFn: (note?: string) =>
      generateStrategy({
        data: { workspaceId, note: note?.trim() || undefined, idempotencyKey: crypto.randomUUID() },
      }),
    onSuccess: (view) => {
      settle(view);
      emitAppEvent("billing:changed");
      toast.success("Your strategy is ready to review");
    },
    onError: (error) => toast.error(message(error, "Couldn't write the strategy")),
  });
  const save = useMutation({
    mutationFn: (args: { strategy: MarketingStrategy; version: number; confirm: boolean }) =>
      saveStrategy({ data: { workspaceId, ...args } }),
    onSuccess: (view, args) => {
      settle(view);
      toast.success(args.confirm ? "Mellox now follows this strategy" : "Saved");
    },
    onError: (error) => toast.error(message(error, "Couldn't save the strategy")),
  });
  return { generate, save };
}
