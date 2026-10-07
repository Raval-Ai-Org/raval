"use client";

// Memory (ADR-0033): React Query hooks for Settings → Memory and the note
// chat shows under a reply. Every key carries the workspace id, so a
// workspace switch drops them.
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { onAppEvent } from "@/lib/app-events";
import {
  addMemory,
  clearMemory,
  editMemory,
  getMemory,
  getMemoryStatus,
  removeMemory,
  restoreMemory,
  setMemoryEnabled,
} from "@/lib/memory.functions";
import type { MemoryView } from "@/lib/memory/contracts";

export const memoryKeys = {
  all: (ws: string | null) => ["memory", ws] as const,
  status: (ws: string | null) => ["memory", ws, "status"] as const,
  view: (ws: string | null) => ["memory", ws, "view"] as const,
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Whether memory exists for this workspace (the flag). Hides entry points when not. */
export function useMemoryAvailable(workspaceId: string | null): boolean {
  const status = useQuery({
    queryKey: memoryKeys.status(workspaceId),
    enabled: !!workspaceId,
    staleTime: 5 * 60_000,
    queryFn: () => getMemoryStatus({ data: { workspaceId: workspaceId! } }),
  });
  // Shown until the server says otherwise: the flag is on almost everywhere.
  return status.data?.available ?? true;
}

export function useMemory(workspaceId: string) {
  const client = useQueryClient();
  // Chat changed memory: show it without waiting for a refetch on focus.
  useEffect(
    () =>
      onAppEvent("memory:changed", () => {
        void client.invalidateQueries({ queryKey: memoryKeys.view(workspaceId) });
      }),
    [client, workspaceId],
  );
  return useQuery({
    queryKey: memoryKeys.view(workspaceId),
    staleTime: 15_000,
    queryFn: () => getMemory({ data: { workspaceId } }),
  });
}

export function useMemoryActions(workspaceId: string) {
  const client = useQueryClient();
  const settle = {
    onSuccess: (view: MemoryView) => client.setQueryData(memoryKeys.view(workspaceId), view),
    onError: (error: unknown) => toast.error(message(error, "Couldn't save. Try again.")),
  };
  const ws = { workspaceId };
  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) => setMemoryEnabled({ data: { ...ws, enabled } }),
    ...settle,
  });
  const add = useMutation({
    mutationFn: (input: { body: string; hours: number | null }) =>
      addMemory({ data: { ...ws, ...input } }),
    ...settle,
  });
  const edit = useMutation({
    mutationFn: (input: { id: string; body?: string; hours?: number | null }) =>
      editMemory({ data: { ...ws, ...input } }),
    ...settle,
  });
  const restore = useMutation({
    mutationFn: (id: string) => restoreMemory({ data: { ...ws, id } }),
    ...settle,
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeMemory({ data: { ...ws, id } }),
    onError: settle.onError,
    onSuccess: (view: MemoryView, id: string) => {
      settle.onSuccess(view);
      toast("Removed from memory", {
        action: { label: "Undo", onClick: () => restore.mutate(id) },
      });
    },
  });
  const clear = useMutation({
    mutationFn: () => clearMemory({ data: { ...ws, confirm: "CLEAR" } }),
    ...settle,
  });
  return {
    setEnabled,
    add,
    edit,
    remove,
    restore,
    clear,
    busy:
      setEnabled.isPending ||
      add.isPending ||
      edit.isPending ||
      remove.isPending ||
      restore.isPending ||
      clear.isPending,
  };
}
