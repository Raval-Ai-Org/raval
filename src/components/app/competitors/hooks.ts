"use client";
// Query keys and mutations for Competitors.
//
// Every key carries the workspace id, so the workspace provider can drop them
// all on a switch and one brand's competitors can never render under another.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  addCompetitor,
  discoverCompetitors,
  getCompetitorOverview,
  markCompetitorUpdatesRead,
  refreshCompetitor,
  removeCompetitor,
  setCompetitorStatus,
  trackCompetitors,
} from "@/lib/competitors.functions";

export const competitorKeys = {
  all: (ws: string | null) => ["competitors", ws] as const,
  overview: (ws: string | null) => ["competitors", ws, "overview"] as const,
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Research finishes in the background, so the overview refetches while any
 * competitor is still being worked on — and stops the moment none is. The
 * decision reads the query's own data, so callers need no extra state.
 */
export function useCompetitorOverview(workspaceId: string | null) {
  return useQuery({
    queryKey: competitorKeys.overview(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const working = data.competitors.some(
        (competitor) =>
          competitor.profileStatus === "running" || competitor.profileStatus === "pending",
      );
      return working ? 8_000 : false;
    },
    queryFn: () => getCompetitorOverview({ data: { workspaceId: workspaceId as string } }),
  });
}

function useInvalidate(workspaceId: string | null) {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: competitorKeys.all(workspaceId) });
}

export function useDiscoverCompetitors(workspaceId: string | null) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: () => discoverCompetitors({ data: { workspaceId: workspaceId as string } }),
    onSuccess: (result) => {
      invalidate();
      if (!result.available) {
        toast.error("Web research isn't set up", {
          description: "Ask your admin to add a research key on the server.",
        });
        return;
      }
      if (!result.suggestions.length) {
        toast("No new competitors found", {
          description: "We looked but didn't find anyone new. Add one by hand instead.",
        });
        return;
      }
      toast.success(
        `Found ${result.suggestions.length} possible competitor${result.suggestions.length === 1 ? "" : "s"}`,
        { description: "Pick the ones that are real and we'll start watching them." },
      );
    },
    onError: (error) =>
      toast.error("We couldn't look for competitors", {
        description: message(error, "Try again in a moment."),
      }),
  });
}

export function useAddCompetitor(workspaceId: string | null) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: (input: { url: string; name?: string }) =>
      addCompetitor({ data: { workspaceId: workspaceId as string, ...input } }),
    onSuccess: (competitor) => {
      invalidate();
      toast.success(`Watching ${competitor.name}`, {
        description: "We're reading their site now. It'll fill in shortly.",
      });
    },
    onError: (error) =>
      toast.error("We couldn't add that", {
        description: message(error, "Check the website address and try again."),
      }),
  });
}

export function useSetCompetitorStatus(workspaceId: string | null) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: (input: { competitorId: string; status: "tracked" | "ignored" | "suggested" }) =>
      setCompetitorStatus({ data: { workspaceId: workspaceId as string, ...input } }),
    onSuccess: (_result, input) => {
      invalidate();
      if (input.status === "tracked") toast.success("Added to your competitors");
    },
    onError: (error) =>
      toast.error("That didn't save", { description: message(error, "Try again in a moment.") }),
  });
}

export function useTrackCompetitors(workspaceId: string | null) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: (competitorIds: string[]) =>
      trackCompetitors({ data: { workspaceId: workspaceId as string, competitorIds } }),
    onSuccess: (result) => {
      invalidate();
      toast.success(`Watching ${result.tracked} competitor${result.tracked === 1 ? "" : "s"}`, {
        description: "We're reading their sites now.",
      });
    },
    onError: (error) =>
      toast.error("That didn't save", { description: message(error, "Try again in a moment.") }),
  });
}

export function useRefreshCompetitor(workspaceId: string | null) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: (input: { competitorId: string; full?: boolean }) =>
      refreshCompetitor({ data: { workspaceId: workspaceId as string, ...input } }),
    onSuccess: () => {
      invalidate();
      toast.success("Looking again", { description: "This takes a minute or two." });
    },
    onError: (error) =>
      toast.error("We couldn't start that", {
        description: message(error, "Try again in a moment."),
      }),
  });
}

export function useMarkUpdatesRead(workspaceId: string | null) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: (competitorId?: string | null) =>
      markCompetitorUpdatesRead({
        data: { workspaceId: workspaceId as string, competitorId: competitorId ?? null },
      }),
    onSuccess: () => invalidate(),
    onError: (error) =>
      toast.error("That didn't save", { description: message(error, "Try again in a moment.") }),
  });
}

export function useRemoveCompetitor(workspaceId: string | null) {
  const invalidate = useInvalidate(workspaceId);
  return useMutation({
    mutationFn: (competitorId: string) =>
      removeCompetitor({ data: { workspaceId: workspaceId as string, competitorId } }),
    onSuccess: () => {
      invalidate();
      toast.success("Removed");
    },
    onError: (error) =>
      toast.error("We couldn't remove that", {
        description: message(error, "Try again in a moment."),
      }),
  });
}
