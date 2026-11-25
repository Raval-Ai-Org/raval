"use client";
// EngagePanel — Inbox: comments on the brand's own Instagram and Facebook
// posts. Mox drafts a reply on a click; a person reads it, edits it and
// presses Send. Nothing is read, drafted or sent by itself. Query keys carry
// the workspace id, so a workspace switch drops them.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOptionalWorkspaceRole } from "@/components/workspace/WorkspaceProvider";
import { useConnectWindow } from "@/components/app/connectors/useConnectWindow";
import { PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Inbox, RefreshCw, Send, Sparkles, X } from "@/components/icons";
import { toast } from "@/lib/toast";
import {
  disconnectMeta,
  dismissEngageComment,
  draftEngageReply,
  getEngageHome,
  sendEngageReply,
  startMetaConnect,
  syncEngage,
  type EngageComment,
  type EngageHome,
} from "@/lib/engage.functions";
import { MAX_REPLY_CHARS } from "@/lib/engage/reply";
import { PLATFORM_LABEL } from "@/lib/engage/contracts";

export const engageKeys = {
  home: (ws: string) => ["engage", ws, "home"] as const,
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins || 1} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short" });
}

export function EngagePanel({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const role = useOptionalWorkspaceRole();
  const canEdit = role !== "viewer";
  const key = engageKeys.home(workspaceId);
  const home = useQuery({
    queryKey: key,
    queryFn: () => getEngageHome({ data: { workspaceId } }),
    staleTime: 30_000,
  });
  const reload = () => client.invalidateQueries({ queryKey: key });

  const sync = useMutation({
    mutationFn: () => syncEngage({ data: { workspaceId } }),
    onSuccess: (r) => {
      if (r.errors) toast.error("Some comments couldn't be read. See the account below.");
      else
        toast.success(
          r.added ? `${r.added} new comment${r.added === 1 ? "" : "s"}` : "No new comments",
        );
      void reload();
    },
    onError: (e) => toast.error(message(e, "Couldn't read comments.")),
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
      .catch((e) => toast.error(message(e, "Couldn't start the Meta connection.")));

  const disconnect = useMutation({
    mutationFn: () => disconnectMeta({ data: { workspaceId } }),
    onSuccess: () => {
      toast.success("Disconnected");
      void reload();
    },
    onError: (e) => toast.error(message(e, "Couldn't disconnect.")),
  });

  if (home.isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  if (home.error || !home.data)
    return (
      <ErrorState
        description={message(home.error, "The inbox didn't load.")}
        onRetry={() => void reload()}
      />
    );

  const data = home.data;
  if (!data.connection)
    return (
      <EmptyState
        icon={Inbox}
        title="Answer comments from one place"
        description={
          data.configured
            ? "Connect your Instagram professional account and Facebook Page. Mox drafts a reply to each comment; you read it and press Send."
            : "Instagram and Facebook replies aren't set up on this server yet."
        }
        action={
          data.configured && canEdit ? (
            <Button className="rounded-full" onClick={connect} disabled={metaWindow.waiting}>
              {metaWindow.waiting ? "Waiting for Meta…" : "Connect Instagram and Facebook"}
            </Button>
          ) : undefined
        }
      />
    );

  return (
    <div className="space-y-5">
      <AccountBar
        data={data}
        canEdit={canEdit}
        syncing={sync.isPending}
        waiting={metaWindow.waiting}
        onSync={() => sync.mutate()}
        onConnect={connect}
        onDisconnect={() => disconnect.mutate()}
      />
      {data.comments.length === 0 ? (
        <EmptyState
          size="sm"
          icon={Inbox}
          title="No comments waiting"
          description="Press Refresh to read the latest comments on your posts."
        />
      ) : (
        <ul className="space-y-3">
          {data.comments.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              workspaceId={workspaceId}
              canEdit={canEdit}
              onChanged={() => void reload()}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function AccountBar(props: {
  data: EngageHome;
  canEdit: boolean;
  syncing: boolean;
  waiting: boolean;
  onSync: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const { data } = props;
  const conn = data.connection!;
  return (
    <div className="ds-card rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex -space-x-2">
          <PlatformAppIcon platform="instagram" size={32} />
          <PlatformAppIcon platform="facebook" size={32} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{conn.accountName}</p>
          <p className="text-xs text-muted-foreground">
            {data.counts.waiting} waiting · {data.counts.replied} answered
          </p>
        </div>
        {props.canEdit && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={props.onSync}
              disabled={props.syncing || conn.status !== "active"}
            >
              <RefreshCw className={props.syncing ? "size-4 animate-spin" : "size-4"} />
              {props.syncing ? "Reading…" : "Refresh"}
            </Button>
            {conn.status !== "active" && (
              <Button
                size="sm"
                className="rounded-full"
                onClick={props.onConnect}
                disabled={props.waiting}
              >
                Reconnect
              </Button>
            )}
            <Button size="sm" variant="ghost" className="rounded-full" onClick={props.onDisconnect}>
              Disconnect
            </Button>
          </div>
        )}
      </div>
      {conn.lastError && <p className="mt-3 text-sm text-destructive">{conn.lastError}</p>}
      {data.pages.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {data.pages.map((p) => (
            <li key={p.id} className="rounded-full border px-3 py-1">
              {p.pageName}
              {p.igUsername ? ` · @${p.igUsername}` : " · no Instagram linked"}
              {p.lastError ? ` · ${p.lastError}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CommentCard(props: {
  comment: EngageComment;
  workspaceId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const c = props.comment;
  const [text, setText] = useState(c.draft ?? "");
  useEffect(() => setText(c.draft ?? ""), [c.draft]);
  const done = c.status === "replied";
  const limit = MAX_REPLY_CHARS[c.platform];
  const ids = { workspaceId: props.workspaceId, commentId: c.id };

  const draft = useMutation({
    mutationFn: () => draftEngageReply({ data: ids }),
    onSuccess: (d) => {
      setText(d.text);
      if (d.removed) toast("Mox left out a line with a figure your brand never gave.");
    },
    onError: (e) => toast.error(message(e, "Mox couldn't write a draft.")),
  });
  const send = useMutation({
    mutationFn: () => sendEngageReply({ data: { ...ids, text } }),
    onSuccess: (r) => {
      if (r.status === "replied") toast.success(`Reply sent on ${PLATFORM_LABEL[c.platform]}`);
      else
        toast("Meta didn't confirm the reply", {
          description: "Press Send again: Mellox checks first.",
        });
      props.onChanged();
    },
    onError: (e) => {
      toast.error(message(e, "The reply didn't send."));
      props.onChanged();
    },
  });
  const dismiss = useMutation({
    mutationFn: () => dismissEngageComment({ data: ids }),
    onSuccess: props.onChanged,
  });

  return (
    <li className="rounded-2xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <PlatformAppIcon platform={c.platform} size={28} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{c.authorName ?? "Someone"}</span> on{" "}
            {c.platform === "instagram" && c.igUsername ? `@${c.igUsername}` : c.pageName} ·{" "}
            {ago(c.commentedAt)}
            {c.postPermalink && (
              <>
                {" · "}
                <a
                  href={c.postPermalink}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                >
                  View post
                </a>
              </>
            )}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
          {c.postCaption && (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">On: {c.postCaption}</p>
          )}
        </div>
      </div>

      {done ? (
        <div className="mt-3 rounded-xl bg-muted/50 p-3 text-sm">
          <p className="text-xs text-muted-foreground">
            You replied{c.repliedAt ? ` ${ago(c.repliedAt)}` : ""}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{c.replyText}</p>
        </div>
      ) : props.canEdit ? (
        <div className="mt-3 space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a reply, or let Mox draft one."
            rows={3}
            maxLength={limit}
            aria-label={`Reply to ${c.authorName ?? "this comment"}`}
          />
          {c.lastError && <p className="text-xs text-destructive">{c.lastError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              onClick={() => draft.mutate()}
              disabled={draft.isPending || send.isPending}
            >
              <Sparkles className="size-4" />
              {draft.isPending ? "Writing…" : text ? "Draft again" : "Draft with Mox"}
            </Button>
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => send.mutate()}
              disabled={!text.trim() || send.isPending || draft.isPending || c.status === "sending"}
            >
              <Send className="size-4" />
              {send.isPending || c.status === "sending" ? "Sending…" : "Send"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto rounded-full"
              onClick={() => dismiss.mutate()}
              disabled={dismiss.isPending || send.isPending}
            >
              <X className="size-4" />
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
