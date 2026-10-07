"use client";

// Settings → AI assistants. Lets an admin allow Claude, ChatGPT and other
// assistants to work in this workspace, and shows what they did. The screen
// itself is McpScreen; this file only loads and saves.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { getMcpSettings, listMcpActivity, updateMcpSettings } from "@/lib/mcp.functions";
import { McpScreen } from "./McpScreen";

// Every key carries the workspace id, so a workspace switch drops them.
const keys = {
  all: (ws: string) => ["mcp", ws] as const,
  settings: (ws: string) => ["mcp", ws, "settings"] as const,
  activity: (ws: string) => ["mcp", ws, "activity"] as const,
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function McpConnector({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: keys.settings(workspaceId),
    queryFn: () => getMcpSettings({ data: { workspaceId } }),
  });
  const canManage = settings.data?.canManage ?? false;
  const enabled = settings.data?.enabled ?? false;
  const activity = useQuery({
    queryKey: keys.activity(workspaceId),
    queryFn: () => listMcpActivity({ data: { workspaceId } }),
    enabled: canManage && enabled,
  });

  const save = useMutation({
    mutationFn: (next: { enabled: boolean; allowWrites: boolean }) =>
      updateMcpSettings({ data: { workspaceId, ...next } }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.all(workspaceId) }),
    onError: (error) => toast.error(message(error, "Couldn't save. Try again.")),
  });

  if (settings.isLoading)
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-44 w-full rounded-[20px]" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-28 rounded-[20px]" />
          <Skeleton className="h-28 rounded-[20px]" />
        </div>
      </div>
    );
  if (settings.isError || !settings.data) {
    return (
      <ErrorState
        size="sm"
        title="AI assistants aren't available"
        detail={message(settings.error, "Try again in a moment.")}
        onRetry={() => settings.refetch()}
      />
    );
  }

  const { allowWrites, serverUrl, tools } = settings.data;

  return (
    <McpScreen
      enabled={enabled}
      allowWrites={allowWrites}
      canManage={canManage}
      saving={save.isPending}
      serverUrl={serverUrl}
      tools={tools}
      activity={canManage ? (activity.isLoading ? null : (activity.data ?? [])) : undefined}
      onChange={(next) => save.mutate(next)}
      onCopy={async () => {
        try {
          await navigator.clipboard.writeText(serverUrl);
          toast.success("Link copied");
          return true;
        } catch {
          toast.error("Couldn't copy. Select the link and copy it.");
          return false;
        }
      }}
    />
  );
}
