"use client";
// CommunityPanel — wires CommunityScreen to the community RPC. Keys carry the
// workspace id, so a workspace switch drops them. While a refresh runs the
// view refetches until it finishes; nothing is looked up or spent by itself.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOptionalWorkspaceRole } from "@/components/workspace/WorkspaceProvider";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import {
  addCommunityWatch,
  draftCommunityReply,
  getCommunityHome,
  pauseCommunity,
  refreshCommunity,
  removeCommunityWatch,
  setCommunityThreadStatus,
  type CommunityHome,
  type ThreadStatus,
} from "@/lib/community.functions";
import type { CommunityWatchKind } from "@/lib/community/contracts";
import { CommunityScreen, type CommunityHandlers } from "./CommunityScreen";

export const communityKeys = {
  home: (ws: string) => ["community", ws, "home"] as const,
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function CommunityPanel({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const role = useOptionalWorkspaceRole();
  const canEdit = role !== "viewer";
  const key = communityKeys.home(workspaceId);
  const [draftingId, setDraftingId] = useState<string | null>(null);

  const home = useQuery({
    queryKey: key,
    queryFn: () => getCommunityHome({ data: { workspaceId } }),
    staleTime: 60_000,
    refetchInterval: (q) => {
      const state = (q.state.data as CommunityHome | undefined)?.job.state;
      return state === "queued" || state === "running" ? 8_000 : false;
    },
  });
  const reload = () => client.invalidateQueries({ queryKey: key });

  const refresh = useMutation({
    mutationFn: () => refreshCommunity({ data: { workspaceId } }),
    onSuccess: (r) => {
      if (!r.started && r.reason === "recent") {
        toast("Mellox looked a little while ago", {
          description: "New threads show up with the next daily look.",
        });
      }
      void reload();
    },
    onError: (e) =>
      toast.error("Couldn't start looking", { description: message(e, "Try again in a moment.") }),
  });

  const pause = useMutation({
    mutationFn: () => pauseCommunity({ data: { workspaceId } }),
    onSuccess: () => void reload(),
    onError: (e) => toast.error("Couldn't pause", { description: message(e, "Try again.") }),
  });

  const status = useMutation({
    mutationFn: (v: { threadId: string; status: ThreadStatus }) =>
      setCommunityThreadStatus({ data: { workspaceId, ...v } }),
    onMutate: async (v) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<CommunityHome>(key);
      if (before) {
        client.setQueryData<CommunityHome>(key, {
          ...before,
          threads:
            v.status === "hidden"
              ? before.threads.filter((t) => t.id !== v.threadId)
              : before.threads.map((t) => (t.id === v.threadId ? { ...t, status: v.status } : t)),
        });
      }
      return { before };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.before) client.setQueryData(key, ctx.before);
      toast.error("Couldn't save that", { description: message(e, "Try again.") });
    },
    onSettled: () => void reload(),
  });

  const addWatch = useMutation({
    mutationFn: (v: { kind: CommunityWatchKind; value: string }) =>
      addCommunityWatch({ data: { workspaceId, ...v } }),
    onSuccess: () => void reload(),
    onError: (e) => toast.error("Couldn't add that", { description: message(e, "Try again.") }),
  });

  const removeWatch = useMutation({
    mutationFn: (watchId: string) => removeCommunityWatch({ data: { workspaceId, watchId } }),
    onSuccess: () => void reload(),
    onError: (e) => toast.error("Couldn't remove that", { description: message(e, "Try again.") }),
  });

  const draft = useMutation({
    mutationFn: (threadId: string) =>
      draftCommunityReply({
        data: { workspaceId, threadId, idempotencyKey: crypto.randomUUID() },
      }),
    onMutate: (threadId) => setDraftingId(threadId),
    onSuccess: (reply, threadId) => {
      const before = client.getQueryData<CommunityHome>(key);
      if (before) {
        client.setQueryData<CommunityHome>(key, {
          ...before,
          threads: before.threads.map((t) => (t.id === threadId ? { ...t, reply } : t)),
        });
      }
    },
    onError: (e) =>
      toast.error("Couldn't write a reply", { description: message(e, "Try again in a moment.") }),
    onSettled: () => setDraftingId(null),
  });

  if (home.isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1040px] space-y-3">
        <Skeleton className="h-14 w-2/3 rounded-[var(--ds-radius-tile)]" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-[var(--ds-radius-tile)]" />
        ))}
      </div>
    );
  }
  if (home.error || !home.data) {
    return (
      <ErrorState
        title="We couldn't load community threads"
        detail={home.error instanceof Error ? home.error.message : undefined}
        onRetry={() => void home.refetch()}
      />
    );
  }

  const handlers: CommunityHandlers = {
    refresh: () => refresh.mutate(),
    pause: () => pause.mutate(),
    setStatus: (threadId, s) => status.mutate({ threadId, status: s }),
    addWatch: (kind, value) => addWatch.mutate({ kind, value }),
    removeWatch: (watchId) => removeWatch.mutate(watchId),
    draftReply: (threadId) => draft.mutate(threadId),
    copy: (text) => {
      void navigator.clipboard
        .writeText(text)
        .then(() =>
          toast.success("Copied", { description: "Paste it in the thread and post it yourself." }),
        )
        .catch(() => toast.error("Couldn't copy. Select the text and copy it instead."));
    },
  };

  return (
    <CommunityScreen
      home={home.data}
      handlers={handlers}
      refreshing={refresh.isPending}
      draftingId={draftingId}
      canEdit={canEdit}
    />
  );
}
