"use client";
// Comments — every comment waiting for the brand, and what its automation
// did. Mox drafts on a click; a person reads, edits and presses Send.
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import { GroupLabel, SurfacePage, Tile } from "@/components/app/surface/SurfaceLayout";
import { dsGhostBtn, dsInkBtn } from "@/components/app/surface/buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { Inbox, MessageSquare, RefreshCw, Send, Sparkles, X, Zap } from "@/components/icons";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  dismissEngageComment,
  draftEngageReply,
  sendEngageDm,
  sendEngageReply,
  type EngageComment,
  type EngageHome,
} from "@/lib/engage.functions";
import { MAX_REPLY_CHARS } from "@/lib/engage/reply";
import { PLATFORM_LABEL } from "@/lib/engage/contracts";
import { Chip, Segmented, ago, errorText } from "./engage-shared";

type Filter = "waiting" | "automated" | "done";

export function CommentsTab(props: {
  workspaceId: string;
  data: EngageHome;
  canEdit: boolean;
  syncing: boolean;
  waiting: boolean;
  onSync: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onChanged: () => void;
  onOpenAutomations: () => void;
}) {
  const { data } = props;
  const [filter, setFilter] = useState<Filter>("waiting");
  const shown = useMemo(
    () =>
      data.comments.filter((c) =>
        filter === "waiting"
          ? c.status !== "replied"
          : filter === "automated"
            ? c.autoSent || c.dmStatus === "sent"
            : c.status === "replied",
      ),
    [data.comments, filter],
  );
  return (
    <SurfacePage width="wide">
      <AccountBar {...props} />
      {data.rules.length === 0 && props.canEdit && (
        <Tile className="mt-4 flex flex-wrap items-center gap-3">
          <span className="ds-grad-pill grid size-9 place-items-center rounded-full text-[var(--mox-ink)]">
            <Zap className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Let automations answer the easy ones</p>
            <p className="text-xs text-muted-foreground">
              Someone comments “link”, they get it by DM. Price questions get a draft from Mox.
            </p>
          </div>
          <button
            type="button"
            className={cn(dsInkBtn, "h-9 px-4 text-[13px]")}
            onClick={props.onOpenAutomations}
          >
            Set one up
          </button>
        </Tile>
      )}
      <GroupLabel
        action={
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { id: "waiting", label: `Waiting · ${data.counts.waiting}` },
              { id: "automated", label: "By automations" },
              { id: "done", label: "Answered" },
            ]}
          />
        }
      >
        Comments
      </GroupLabel>
      {shown.length === 0 ? (
        <EmptyState
          size="sm"
          icon={Inbox}
          title={filter === "waiting" ? "Nothing waiting" : "Nothing here yet"}
          description={
            filter === "waiting"
              ? "New comments arrive by themselves while an automation is live, or press Refresh."
              : "Answered comments show here."
          }
        />
      ) : (
        <ul className="space-y-3">
          {shown.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              workspaceId={props.workspaceId}
              canEdit={props.canEdit}
              onChanged={props.onChanged}
            />
          ))}
        </ul>
      )}
    </SurfacePage>
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
    <Tile>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex -space-x-2">
          <PlatformAppIcon platform="instagram" size={34} />
          <PlatformAppIcon platform="facebook" size={34} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{conn.accountName}</p>
          <p className="text-xs text-muted-foreground">
            {data.counts.waiting} waiting · {data.counts.replied} answered ·{" "}
            {data.counts.autoReplied} by automations
          </p>
        </div>
        {props.canEdit && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
              onClick={props.onSync}
              disabled={props.syncing || conn.status !== "active"}
            >
              <RefreshCw className={props.syncing ? "size-4 animate-spin" : "size-4"} />
              {props.syncing ? "Reading…" : "Refresh"}
            </button>
            {conn.status !== "active" && (
              <button
                type="button"
                className={cn(dsInkBtn, "h-9 px-4 text-[13px]")}
                onClick={props.onConnect}
                disabled={props.waiting}
              >
                Reconnect
              </button>
            )}
            <button
              type="button"
              className={cn(dsGhostBtn, "h-9 border-transparent px-3 text-[13px]")}
              onClick={props.onDisconnect}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
      {conn.lastError && <p className="mt-3 text-sm text-destructive">{conn.lastError}</p>}
      {data.pages.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {data.pages.map((p) => (
            <li key={p.id}>
              <Chip tone={p.lastError ? "destructive" : "default"}>
                {p.pageName}
                {p.igUsername ? ` · @${p.igUsername}` : " · no Instagram linked"}
                {p.lastError ? ` · ${p.lastError}` : ""}
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

const DM_LABEL: Record<EngageComment["dmStatus"], string> = {
  none: "",
  pending: "DM waits for Send",
  sent: "DM sent",
  failed: "DM failed",
  skipped: "DM skipped",
  unknown: "DM not confirmed",
};

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
    onError: (e) => toast.error(errorText(e, "Mox couldn't write a draft.")),
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
      toast.error(errorText(e, "The reply didn't send."));
      props.onChanged();
    },
  });
  const sendDm = useMutation({
    mutationFn: () => sendEngageDm({ data: ids }),
    onSuccess: (r) => {
      if (r.dmStatus === "sent") toast.success("Private message sent");
      else toast(DM_LABEL[r.dmStatus] || "Message not sent");
      props.onChanged();
    },
    onError: (e) => toast.error(errorText(e, "The message didn't send.")),
  });
  const dismiss = useMutation({
    mutationFn: () => dismissEngageComment({ data: ids }),
    onSuccess: props.onChanged,
  });

  return (
    <Tile as="li">
      <div className="flex items-start gap-3">
        <PlatformAppIcon platform={c.platform} size={30} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{c.authorName ?? "Someone"}</span> on{" "}
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
          <p className="mt-1 whitespace-pre-wrap text-[15px]">{c.body}</p>
          {c.postCaption && (
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">On: {c.postCaption}</p>
          )}
          {(c.ruleName || c.dmStatus !== "none") && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.ruleName && (
                <Chip tone="primary">
                  <Zap className="size-3" />
                  {c.ruleName}
                  {c.matchedKeyword ? ` · “${c.matchedKeyword}”` : ""}
                </Chip>
              )}
              {c.dmStatus !== "none" && (
                <Chip
                  tone={
                    c.dmStatus === "sent"
                      ? "success"
                      : c.dmStatus === "pending"
                        ? "default"
                        : "warning"
                  }
                >
                  <MessageSquare className="size-3" />
                  {DM_LABEL[c.dmStatus]}
                </Chip>
              )}
            </div>
          )}
          {c.dmError && c.dmStatus !== "sent" && (
            <p className="mt-1 text-xs text-muted-foreground">{c.dmError}</p>
          )}
        </div>
      </div>

      {done ? (
        <div className="mt-3 rounded-2xl bg-[var(--ds-well-bg)] p-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {c.autoSent ? "Your automation replied" : "You replied"}
            {c.repliedAt ? ` ${ago(c.repliedAt)}` : ""}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{c.replyText}</p>
          {props.canEdit && c.dmStatus === "pending" && (
            <button
              type="button"
              className={cn(dsGhostBtn, "mt-2 h-8 px-3 text-xs")}
              onClick={() => sendDm.mutate()}
              disabled={sendDm.isPending}
            >
              <MessageSquare className="size-3.5" />
              {sendDm.isPending ? "Sending…" : "Send the private message"}
            </button>
          )}
        </div>
      ) : props.canEdit ? (
        <div className="mt-3 space-y-2">
          {c.dmStatus === "pending" && c.dmText && (
            <div className="rounded-2xl border border-dashed p-3 text-xs">
              <p className="font-semibold text-muted-foreground">
                Private message, sent with your reply
              </p>
              <p className="mt-1 whitespace-pre-wrap text-foreground/85">{c.dmText}</p>
            </div>
          )}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a reply, or let Mox draft one."
            rows={3}
            maxLength={limit}
            className="rounded-2xl"
            aria-label={`Reply to ${c.authorName ?? "this comment"}`}
          />
          {c.lastError && <p className="text-xs text-destructive">{c.lastError}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
              onClick={() => draft.mutate()}
              disabled={draft.isPending || send.isPending}
            >
              <Sparkles className="size-4" />
              {draft.isPending ? "Writing…" : text ? "Draft again" : "Draft with Mox"}
            </button>
            <button
              type="button"
              className={cn(dsInkBtn, "h-9 px-4 text-[13px]")}
              onClick={() => send.mutate()}
              disabled={!text.trim() || send.isPending || draft.isPending || c.status === "sending"}
            >
              <Send className="size-4" />
              {send.isPending || c.status === "sending" ? "Sending…" : "Send"}
            </button>
            {c.dmStatus === "pending" && !text.trim() && (
              <button
                type="button"
                className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
                onClick={() => sendDm.mutate()}
                disabled={sendDm.isPending}
              >
                <MessageSquare className="size-4" />
                Only the message
              </button>
            )}
            <button
              type="button"
              className={cn(dsGhostBtn, "ml-auto h-9 border-transparent px-3 text-[13px]")}
              onClick={() => dismiss.mutate()}
              disabled={dismiss.isPending || send.isPending}
            >
              <X className="size-4" />
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </Tile>
  );
}
