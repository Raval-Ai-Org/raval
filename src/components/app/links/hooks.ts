"use client";
// Query keys and mutations for Backlink Growth.
//
// Every key carries the workspace id, so the workspace provider can drop them
// all on a switch and one brand's placements can never render under another.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  confirmOrder,
  discardDraft,
  findPlacements,
  getCreditHistory,
  getOrder,
  getOverview,
  recheckPlacement,
  saveSelection,
  suggestLinkText,
  writeBrief,
} from "@/lib/links.functions";

export const linksKeys = {
  all: (ws: string | null) => ["links", ws] as const,
  overview: (ws: string | null) => ["links", ws, "overview"] as const,
  order: (ws: string | null, id: string | null) => ["links", ws, "order", id] as const,
  credits: (ws: string | null) => ["links", ws, "credits"] as const,
  suggest: (ws: string | null, url: string | null) => ["links", ws, "suggest", url] as const,
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useOverview(workspaceId: string | null) {
  return useQuery({
    queryKey: linksKeys.overview(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
    queryFn: () => getOverview({ data: { workspaceId: workspaceId as string } }),
  });
}

/**
 * Orders in flight move without the user doing anything, so the overview
 * refetches while any of them is unfinished — and stops the moment none is.
 * The decision reads the query's own data, so it needs no state from callers.
 */
export function useOverviewPolling(workspaceId: string | null) {
  return useQuery({
    queryKey: linksKeys.overview(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
    refetchInterval: (query) => ((query.state.data?.stats.activeOrders ?? 0) > 0 ? 15_000 : false),
    queryFn: () => getOverview({ data: { workspaceId: workspaceId as string } }),
  });
}

export function useOrder(workspaceId: string | null, orderId: string | null, active: boolean) {
  return useQuery({
    queryKey: linksKeys.order(workspaceId, orderId),
    enabled: Boolean(workspaceId && orderId),
    refetchInterval: active ? 10_000 : false,
    queryFn: () =>
      getOrder({ data: { workspaceId: workspaceId as string, orderId: orderId as string } }),
  });
}

export function useCreditHistory(workspaceId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: linksKeys.credits(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 30_000,
    queryFn: () => getCreditHistory({ data: { workspaceId: workspaceId as string } }),
  });
}

/** Link text suggestions for a page; fetched once per workspace and page. */
export function useLinkTextSuggestions(workspaceId: string | null, targetUrl: string | null) {
  return useQuery({
    queryKey: linksKeys.suggest(workspaceId, targetUrl),
    enabled: Boolean(workspaceId) && Boolean(targetUrl),
    staleTime: 6 * 3600_000,
    retry: false,
    queryFn: () =>
      suggestLinkText({
        data: { workspaceId: workspaceId as string, targetUrl: targetUrl as string },
      }),
  });
}

export function useFindPlacements(workspaceId: string | null) {
  return useMutation({
    mutationFn: (input: {
      targetUrl: string;
      keyword?: string | null;
      maxPriceUsd?: number;
      minAuthority?: number;
      search?: string;
      limit?: number;
    }) => findPlacements({ data: { workspaceId: workspaceId as string, ...input } }),
    onError: (error) =>
      toast.error("We couldn't find placements", {
        description: message(error, "Try again in a moment."),
      }),
  });
}

export function useWriteBrief(workspaceId: string | null) {
  return useMutation({
    mutationFn: (input: { targetUrl: string; keyword: string; guidance?: string | null }) =>
      writeBrief({ data: { workspaceId: workspaceId as string, ...input } }),
    onError: (error) =>
      toast.error("We couldn't write the brief", {
        description: message(error, "You can write your own instead."),
      }),
  });
}

export function useSaveSelection(workspaceId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      targetUrl: string;
      keyword: string;
      donorIds: number[];
      recommendations?: string | null;
    }) => saveSelection({ data: { workspaceId: workspaceId as string, ...input } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: linksKeys.all(workspaceId) }),
    onError: (error) =>
      toast.error("We couldn't save that selection", {
        description: message(error, "Try again in a moment."),
      }),
  });
}

export function useConfirmOrder(workspaceId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { orderId: string; expectedCredits: number }) =>
      confirmOrder({ data: { workspaceId: workspaceId as string, ...input } }),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: linksKeys.all(workspaceId) });
      toast.success("Order placed", {
        description: `${result.credits.toLocaleString()} credits reserved. We'll take it from here.`,
      });
    },
    onError: (error) =>
      toast.error("We couldn't place that order", {
        description: message(error, "Nothing was charged."),
      }),
  });
}

export function useDiscardDraft(workspaceId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      discardDraft({ data: { workspaceId: workspaceId as string, orderId } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: linksKeys.all(workspaceId) }),
    onError: (error) =>
      toast.error("We couldn't clear that", { description: message(error, "Try again.") }),
  });
}

export function useRecheck(workspaceId: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (placementId: string) =>
      recheckPlacement({ data: { workspaceId: workspaceId as string, placementId } }),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: linksKeys.all(workspaceId) });
      // The message already says exactly what was and was not established.
      if (result.result === "live") toast.success("Checked", { description: result.message });
      else toast("Checked", { description: result.message });
    },
    onError: (error) =>
      toast.error("We couldn't check that page", {
        description: message(error, "Try again in a moment."),
      }),
  });
}
