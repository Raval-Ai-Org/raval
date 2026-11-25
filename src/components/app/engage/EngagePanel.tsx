"use client";
// EngagePanel — the Inbox: comments on the brand's own Instagram and Facebook
// posts on one page (InboxScreen): the comments with editable replies, what
// people ask (answers that train Mox) and quick replies.
// Query keys carry the workspace id, so a workspace switch drops them.
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOptionalWorkspaceRole } from "@/components/workspace/WorkspaceProvider";
import { useConnectWindow } from "@/components/app/connectors/useConnectWindow";
import { SurfacePage } from "@/components/app/surface/SurfaceLayout";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Inbox } from "@/components/icons";
import { toast } from "@/lib/toast";
import {
  disconnectMeta,
  getEngageHome,
  startMetaConnect,
  syncEngage,
} from "@/lib/engage.functions";
import { cn } from "@/lib/utils";
import { dsPrimaryBtn } from "@/components/app/surface/buttons";
import { InboxScreen } from "./InboxScreen";
import { engageKeys, errorText } from "./engage-shared";

export { engageKeys } from "./engage-shared";

export function EngagePanel({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const role = useOptionalWorkspaceRole();
  const canEdit = role !== "viewer";
  const key = engageKeys.home(workspaceId);
  const home = useQuery({
    queryKey: key,
    queryFn: () => getEngageHome({ data: { workspaceId } }),
    staleTime: 30_000,
    // Automations reply in the background; keep the inbox current while open.
    refetchInterval: 60_000,
  });
  const reload = () => client.invalidateQueries({ queryKey: key });

  const sync = useMutation({
    mutationFn: () => syncEngage({ data: { workspaceId } }),
    onSuccess: (r) => {
      if (r.errors) toast.error("Some comments couldn't be read. See the account above.");
      else
        toast.success(
          [
            r.added ? `${r.added} new comment${r.added === 1 ? "" : "s"}` : "No new comments",
            r.automated ? `${r.automated} answered by Mox` : "",
            r.asked ? `Mox has ${r.asked} question${r.asked === 1 ? "" : "s"} for you` : "",
          ]
            .filter(Boolean)
            .join(" · "),
        );
      void reload();
    },
    onError: (e) => toast.error(errorText(e, "Couldn't read comments.")),
  });

  const metaWindow = useConnectWindow("meta", workspaceId, (result) => {
    if (result?.status === "connected") {
      toast.success("Instagram and Facebook connected");
      void reload().then(() => sync.mutate());
    } else if (result?.status === "error") toast.error("Meta didn't connect. Try again.");
    else void reload();
  });

  // Same-tab fallback: the callback lands here with ?meta=<result>.
  useEffect(() => {
    const url = new URL(window.location.href);
    const flag = url.searchParams.get("meta");
    if (!flag) return;
    if (flag === "connected") toast.success("Instagram and Facebook connected");
    else if (flag === "error") toast.error("Meta didn't connect. Try again.");
    url.searchParams.delete("meta");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const connect = () =>
    void metaWindow
      .connect(async () => (await startMetaConnect({ data: { workspaceId } })).url)
      .catch((e) => toast.error(errorText(e, "Couldn't start the Meta connection.")));

  const disconnect = useMutation({
    mutationFn: () => disconnectMeta({ data: { workspaceId } }),
    onSuccess: () => {
      toast.success("Disconnected");
      void reload();
    },
    onError: (e) => toast.error(errorText(e, "Couldn't disconnect.")),
  });

  if (home.isLoading)
    return (
      <SurfacePage width="wide">
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
        </div>
      </SurfacePage>
    );
  if (home.error || !home.data)
    return (
      <SurfacePage width="wide">
        <ErrorState
          description={errorText(home.error, "The inbox didn't load.")}
          onRetry={() => void reload()}
        />
      </SurfacePage>
    );

  const data = home.data;
  if (!data.connection)
    return (
      <SurfacePage width="wide">
        <EmptyState
          icon={Inbox}
          title="Answer every comment, even while you sleep"
          description={
            data.configured
              ? "Connect your Instagram professional account and Facebook Page. Teach Mox what people ask, let quick replies answer the easy ones, and send the rest from one place."
              : "Instagram and Facebook replies aren't set up on this server yet."
          }
          action={
            data.configured && canEdit ? (
              <button
                type="button"
                className={cn(dsPrimaryBtn, "h-10 px-5 text-sm")}
                onClick={connect}
                disabled={metaWindow.waiting}
              >
                {metaWindow.waiting ? "Waiting for Meta…" : "Connect Instagram and Facebook"}
              </button>
            ) : undefined
          }
        />
      </SurfacePage>
    );

  return (
    <SurfacePage width="wide">
      <InboxScreen
        workspaceId={workspaceId}
        data={data}
        canEdit={canEdit}
        syncing={sync.isPending}
        waiting={metaWindow.waiting}
        onSync={() => sync.mutate()}
        onConnect={connect}
        onDisconnect={() => disconnect.mutate()}
        onChanged={() => void reload()}
      />
    </SurfacePage>
  );
}
