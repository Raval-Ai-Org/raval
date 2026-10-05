"use client";
// Query keys and mutations for Audience.
//
// Every key carries the workspace id, so the workspace provider can drop them
// all on a switch and one brand's audience can never render under another.
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { emitAppEvent } from "@/lib/app-events";
import {
  isActiveRun,
  type RunView,
  type SubjectKind,
  type TwinInput,
} from "@/lib/audience/contracts";
import {
  buildAudience,
  cancelAudienceRun,
  getAudience,
  getAudienceRun,
  getAudienceScores,
  getAudienceStatus,
  getContentAudience,
  predictContent,
  removeAudienceGroup,
  saveAudienceGroup,
  startAudienceCheck,
  startAudienceComparison,
  startAudienceRanking,
} from "@/lib/audience.functions";
import { ServerFnError } from "@/lib/rpc-client";

export const audienceKeys = {
  all: (ws: string | null) => ["audience", ws] as const,
  status: (ws: string | null) => ["audience", ws, "status"] as const,
  view: (ws: string | null) => ["audience", ws, "view"] as const,
  content: (ws: string | null, id: string | null) => ["audience", ws, "content", id] as const,
  scores: (ws: string | null, ids: string[]) => ["audience", ws, "scores", ids] as const,
  run: (ws: string | null, id: string | null) => ["audience", ws, "run", id] as const,
};

const POLL_MS = 2_000;

/** Versions the caller already has, to be ranked as they are. */
export type RankArgs = {
  kind: SubjectKind;
  platform: string;
  variants: { ref: string; label: string; title: string; body: string }[];
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** A fresh key per click, so a double click is one request and a later click is a new one. */
function newKey(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

/** Whether Audience is on here. Off (or unknown) hides every entry point. */
export function useAudienceEnabled(workspaceId: string | null): boolean {
  const { data } = useQuery({
    queryKey: audienceKeys.status(workspaceId),
    enabled: !!workspaceId,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => getAudienceStatus({ data: { workspaceId: workspaceId! } }),
  });
  return data?.enabled === true;
}

/** The Audience page. Refetches only while groups are being built. */
export function useAudience(workspaceId: string) {
  return useQuery({
    queryKey: audienceKeys.view(workspaceId),
    staleTime: 15_000,
    queryFn: () => getAudience({ data: { workspaceId } }),
    refetchInterval: (query) => {
      const building = query.state.data?.building;
      return building && isActiveRun(building.status) ? POLL_MS : false;
    },
  });
}

/** Scores for a list of pieces (calendar, lists). Empty when the feature is off. */
export function useAudienceScores(workspaceId: string | null, contentItemIds: string[]) {
  const enabled = useAudienceEnabled(workspaceId);
  const ids = [...new Set(contentItemIds)].sort().slice(0, 200);
  return useQuery({
    queryKey: audienceKeys.scores(workspaceId, ids),
    enabled: enabled && ids.length > 0,
    staleTime: 30_000,
    queryFn: () => getAudienceScores({ data: { workspaceId: workspaceId!, contentItemIds: ids } }),
  });
}

/**
 * Everything about one piece: its current score and any check in progress.
 * Polls every two seconds while something is running and stops when it ends.
 */
export function useContentAudience(workspaceId: string | null, contentItemId: string | null) {
  const enabled = useAudienceEnabled(workspaceId);
  return useQuery({
    queryKey: audienceKeys.content(workspaceId, contentItemId),
    enabled: enabled && !!contentItemId,
    staleTime: 10_000,
    retry: (count, error) => !(error instanceof ServerFnError && error.status < 500) && count < 2,
    queryFn: () =>
      getContentAudience({ data: { workspaceId: workspaceId!, contentItemId: contentItemId! } }),
    refetchInterval: (query) => {
      const run = query.state.data?.run;
      return run && isActiveRun(run.status) ? POLL_MS : false;
    },
  });
}

/** One run by id (ranking video concepts, where there is no saved piece). */
export function useAudienceRun(workspaceId: string | null, runId: string | null) {
  return useQuery({
    queryKey: audienceKeys.run(workspaceId, runId),
    enabled: !!workspaceId && !!runId,
    queryFn: () => getAudienceRun({ data: { workspaceId: workspaceId!, runId: runId! } }),
    refetchInterval: (query) => {
      const run = query.state.data;
      return !run || isActiveRun(run.status) ? POLL_MS : false;
    },
  });
}

/** Call `onDone` once when a run that was in progress reaches its end. */
export function useRunFinished(run: RunView | null | undefined, onDone: (run: RunView) => void) {
  const was = useRef<string | null>(null);
  useEffect(() => {
    if (!run) return;
    if (isActiveRun(run.status)) {
      was.current = run.id;
    } else if (was.current === run.id) {
      was.current = null;
      onDone(run);
    }
  }, [run, onDone]);
}

export function useAudienceActions(workspaceId: string) {
  const client = useQueryClient();
  const ws = { workspaceId };
  const refresh = () => void client.invalidateQueries({ queryKey: audienceKeys.all(workspaceId) });
  const charged = () => {
    refresh();
    emitAppEvent("billing:changed");
  };

  const build = useMutation({
    mutationFn: () => buildAudience({ data: { ...ws, key: newKey() } }),
    onSuccess: refresh,
    onError: (e) =>
      toast.error("We couldn't refresh your audience", {
        description: message(e, "Nothing was changed."),
      }),
  });

  const saveGroup = useMutation({
    mutationFn: (args: { id: string | null; group: TwinInput }) =>
      saveAudienceGroup({ data: { ...ws, ...args } }),
    onSuccess: () => {
      toast.success("Saved");
      refresh();
    },
    onError: (e) =>
      toast.error("We couldn't save that", { description: message(e, "Nothing was changed.") }),
  });

  const removeGroup = useMutation({
    mutationFn: (id: string) => removeAudienceGroup({ data: { ...ws, id } }),
    onSuccess: () => {
      toast.success("Removed");
      refresh();
    },
    onError: (e) =>
      toast.error("We couldn't remove that", { description: message(e, "Try again.") }),
  });

  const predict = useMutation({
    mutationFn: (contentItemId: string) => predictContent({ data: { ...ws, contentItemId } }),
    onSuccess: refresh,
    onError: (e) =>
      toast.error("We couldn't score this", { description: message(e, "Try again.") }),
  });

  const check = useMutation({
    mutationFn: (contentItemId: string) =>
      startAudienceCheck({ data: { ...ws, contentItemId, key: newKey() } }),
    onSuccess: charged,
    onError: (e) =>
      toast.error("We couldn't start that", { description: message(e, "Nothing was charged.") }),
  });

  const compare = useMutation({
    mutationFn: (contentItemId: string) =>
      startAudienceComparison({ data: { ...ws, contentItemId, key: newKey() } }),
    onSuccess: charged,
    onError: (e) =>
      toast.error("We couldn't start that", { description: message(e, "Nothing was charged.") }),
  });

  const rank = useMutation({
    mutationFn: (args: RankArgs) =>
      startAudienceRanking({ data: { ...ws, key: newKey(), ...args } }),
    onSuccess: charged,
    onError: (e) =>
      toast.error("We couldn't start that", { description: message(e, "Nothing was charged.") }),
  });

  const cancel = useMutation({
    mutationFn: (runId: string) => cancelAudienceRun({ data: { ...ws, runId } }),
    onSuccess: charged,
    onError: (e) => toast.error("We couldn't stop that", { description: message(e, "Try again.") }),
  });

  return { build, saveGroup, removeGroup, predict, check, compare, rank, cancel };
}
