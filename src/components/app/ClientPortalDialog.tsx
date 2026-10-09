"use client";

/**
 * The client portal (Share → Client portal). Three places in one window:
 * Inbox (what clients said, and what to do about it), New link (pick posts,
 * get a link) and Links (the links that exist).
 *
 * Opened by the "open:client-portal" app event; AppShell mounts it once. The
 * list is loaded once here and shared by all three, so they never disagree.
 */

import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { appendNote } from "@/lib/notes-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dsIconBtn } from "@/components/app/surface/buttons";
import { toast } from "@/lib/toast";
import {
  Users,
  Link as LinkIcon,
  Check,
  Inbox,
  ThumbsUp,
  ThumbsDown,
  Lightbulb,
  MessageSquare,
  Mail,
  RefreshCw,
  Power,
} from "@/components/ui/gemini-icons";
import { cn } from "@/lib/utils";

/** A guardrail finding returned by POST /api/shares when review is needed. */
type ShareFinding = { itemTitle: string; rule: string; severity: "warn" | "block"; detail: string };

type ContentRow = {
  id: string;
  title: string | null;
  body: string | null;
  channel: string | null;
  status: string;
  kind: string;
};
type ShareRow = {
  id: string;
  title: string;
  slug: string;
  client_name: string | null;
  client_email: string | null;
  allow_comments: boolean;
  allow_approvals: boolean;
  allow_download: boolean;
  expires_at: string | null;
  status: string;
  last_viewed_at: string | null;
  view_count: number;
  created_at: string;
};
type EventRow = {
  id: string;
  share_id: string;
  item_id: string | null;
  kind: string;
  body: string | null;
  actor_name: string | null;
  marketer_decision: string;
  actor_type?: "client" | "team";
  created_at: string;
};
type ItemRow = { id: string; share_id: string; title: string | null };

type Portal = {
  shares: ShareRow[];
  events: EventRow[];
  itemTitles: Record<string, string>;
  loaded: boolean;
  failed: boolean;
  refresh: () => Promise<void>;
};

const EVENT_META: Record<string, { icon: any; tone: string; label: string }> = {
  approved: { icon: ThumbsUp, tone: "text-success", label: "Approved" },
  rejected: { icon: ThumbsDown, tone: "text-destructive", label: "Rejected" },
  requested_changes: { icon: MessageSquare, tone: "text-warning", label: "Asked for changes" },
  suggested: { icon: Lightbulb, tone: "text-info", label: "Suggestion" },
  commented: { icon: MessageSquare, tone: "text-foreground/80", label: "Comment" },
  replied: { icon: MessageSquare, tone: "text-muted-foreground", label: "You replied" },
};

const STATUS_WORDS: Record<string, string> = {
  draft: "Draft",
  pending: "In review",
  approved: "Approved",
  rejected: "Rejected",
  scheduled: "Scheduled",
  publishing: "Going out",
  published: "Published",
  failed: "Didn't go out",
  partial_failed: "Partly sent",
};

const isWaiting = (e: EventRow) =>
  e.actor_type !== "team" && e.marketer_decision === "pending" && e.kind !== "viewed";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

async function post(action: string, body: unknown): Promise<Response> {
  return authedFetch(`/api/shares?action=${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function usePortal(workspaceId: string | null, open: boolean): Portal {
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const r = await post("list", { workspaceId });
      if (!r.ok) throw new Error();
      const data = await r.json();
      setShares(data.shares ?? []);
      setEvents(data.events ?? []);
      setItems(data.items ?? []);
      setFailed(false);
      setLoaded(true);
    } catch {
      // Keep the last good list; only a first load shows the error.
      setFailed(true);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !open) return;
    setLoaded(false);
    setFailed(false);
    void refresh();
    const channel = supabase
      .channel(`client-events-inbox:${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "client_events" },
        () => void refresh(),
      )
      .subscribe();
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30_000);
    return () => {
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, open, refresh]);

  const itemTitles = useMemo(
    () => Object.fromEntries(items.map((i) => [i.id, i.title ?? "Post"])),
    [items],
  );
  return { shares, events, itemTitles, loaded, failed, refresh };
}

export function ClientPortalDialog({ workspaceId }: { workspaceId: string | null }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"inbox" | "new" | "links">("inbox");

  useEffect(() => {
    const h = () => setOpen(true);
    addAppEventListener("open:client-portal", h);
    return () => removeAppEventListener("open:client-portal", h);
  }, []);

  const portal = usePortal(workspaceId, open);
  const waiting = portal.events.filter(isWaiting).length;

  return (
    <AppModalShell
      open={open}
      onOpenChange={setOpen}
      size="lg"
      Icon={Users}
      title="Client portal"
      description="Send work to a client and get their answer"
      bodyClassName="px-5 py-5 sm:px-6"
    >
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="inbox">
            Inbox
            {waiting > 0 && (
              <span className="ml-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold tabular-nums text-primary-foreground">
                {waiting}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="new">New link</TabsTrigger>
          <TabsTrigger value="links">
            Links{portal.shares.length ? ` · ${portal.shares.length}` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="inbox" className="mt-5">
          <InboxView workspaceId={workspaceId} portal={portal} onNew={() => setTab("new")} />
        </TabsContent>
        <TabsContent value="new" className="mt-5">
          <NewShareView
            workspaceId={workspaceId}
            onDone={() => {
              void portal.refresh();
              setTab("links");
            }}
          />
        </TabsContent>
        <TabsContent value="links" className="mt-5">
          <ManageView portal={portal} onNew={() => setTab("new")} />
        </TabsContent>
      </Tabs>
    </AppModalShell>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[68px] w-full rounded-[var(--ds-radius-well)]" />
      ))}
    </div>
  );
}

/* ───────── Inbox ───────── */
function InboxView({
  workspaceId,
  portal,
  onNew,
}: {
  workspaceId: string | null;
  portal: Portal;
  onNew: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const decide = async (
    ev: EventRow,
    decision: "accepted" | "dismissed" | "applied",
    quiet = false,
  ): Promise<boolean> => {
    setBusy(ev.id);
    try {
      const r = await post("decide", { eventId: ev.id, decision });
      if (!r.ok) throw new Error(await errorText(r));
      const data = (await r.json().catch(() => null)) as { content?: string } | null;
      if (data?.content === "approved") emitAppEvent("content:changed");
      if (!quiet) {
        toast.success(
          decision === "dismissed"
            ? "Dismissed"
            : data?.content === "approved"
              ? "Post approved"
              : data?.content === "already"
                ? "Marked as done"
                : "Done",
          {
            description:
              data?.content === "approved" ? "It's ready for a time in Publish." : undefined,
          },
        );
      }
      await portal.refresh();
      return true;
    } catch (e: any) {
      toast.error("Couldn't do that", { description: e?.message });
      return false;
    } finally {
      setBusy(null);
    }
  };

  // Notes live in this browser, so the note is written first and the
  // suggestion is only marked done once it is really kept.
  const saveAsNote = async (ev: EventRow) => {
    if (!workspaceId) return;
    const text = [`Client suggestion · ${ev.actor_name ?? "client"}`, ev.body ?? ""]
      .filter(Boolean)
      .join("\n\n");
    if (!appendNote(workspaceId, { text, color: "sky" })) {
      toast.error("Couldn't save the note", { description: "Browser storage is unavailable." });
      return;
    }
    if (await decide(ev, "applied", true)) toast.success("Saved to your notes");
  };

  const reply = async (ev: EventRow) => {
    if (!replyText.trim()) return;
    setBusy(`reply:${ev.id}`);
    try {
      const r = await post("reply", { shareId: ev.share_id, body: replyText.trim() });
      if (!r.ok) throw new Error(await errorText(r));
      setReplyText("");
      setReplyTo(null);
      toast.success("Reply sent", { description: "Your client sees it on their page." });
      await portal.refresh();
    } catch (e: any) {
      toast.error("Couldn't send the reply", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const sharesById = useMemo(
    () => Object.fromEntries(portal.shares.map((s) => [s.id, s])),
    [portal.shares],
  );
  const waiting = portal.events.filter(isWaiting);
  const earlier = portal.events.filter((e) => !isWaiting(e) && e.kind !== "viewed").slice(0, 20);

  if (!portal.loaded) {
    return portal.failed ? (
      <ErrorState size="sm" title="Couldn't load the inbox" onRetry={() => void portal.refresh()} />
    ) : (
      <ListSkeleton />
    );
  }

  if (portal.shares.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nothing shared yet"
        description="Send a client a link to your posts. Their answers show up here."
        action={<Button onClick={onNew}>Make a link</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="ds-label mb-2">Waiting for you · {waiting.length}</div>
        {waiting.length === 0 ? (
          <div className="ds-well px-4 py-6 text-center text-[13px] text-muted-foreground">
            You&apos;re all caught up.
          </div>
        ) : (
          <ul className="space-y-2">
            {waiting.map((ev) => {
              const meta = EVENT_META[ev.kind] ?? EVENT_META.commented;
              const Icon = meta.icon;
              const share = sharesById[ev.share_id];
              const about = ev.item_id ? portal.itemTitles[ev.item_id] : null;
              const working = busy === ev.id;
              return (
                <li key={ev.id} className="ds-tile p-3.5">
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[var(--ds-well-bg)]",
                        meta.tone,
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px]">
                        <span className="font-semibold">{ev.actor_name ?? "Your client"}</span>{" "}
                        <span className={cn("font-medium", meta.tone)}>
                          · {meta.label.toLowerCase()}
                        </span>
                      </p>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {[about, share?.title, shortDate(ev.created_at)]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {ev.body && (
                        <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed">
                          {ev.body}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {ev.kind === "approved" ? (
                          <Button
                            size="sm"
                            loading={working}
                            onClick={() => decide(ev, "accepted")}
                          >
                            Approve post
                          </Button>
                        ) : ev.kind === "suggested" ? (
                          <Button size="sm" loading={working} onClick={() => saveAsNote(ev)}>
                            Save as note
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            loading={working}
                            onClick={() => decide(ev, "accepted")}
                          >
                            Mark as done
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={working}
                          onClick={() => {
                            setReplyText("");
                            setReplyTo(replyTo === ev.id ? null : ev.id);
                          }}
                        >
                          Reply
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={working}
                          onClick={() => decide(ev, "dismissed")}
                        >
                          Dismiss
                        </Button>
                      </div>
                      {replyTo === ev.id && (
                        <div className="mt-2.5 space-y-2">
                          <Textarea
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            rows={2}
                            autoFocus
                            placeholder="Write a reply"
                            aria-label="Reply to your client"
                          />
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              onClick={() => reply(ev)}
                              disabled={!replyText.trim()}
                              loading={busy === `reply:${ev.id}`}
                            >
                              Send reply
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {earlier.length > 0 && (
        <div>
          <div className="ds-label mb-2">Earlier</div>
          <ul className="ds-tile divide-y divide-border/50 overflow-hidden">
            {earlier.map((ev) => {
              const meta = EVENT_META[ev.kind] ?? EVENT_META.commented;
              const Icon = meta.icon;
              return (
                <li key={ev.id} className="flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px]">
                  <Icon className={cn("size-3.5 shrink-0", meta.tone)} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">
                      {ev.actor_type === "team" ? "You replied" : meta.label}
                    </span>
                    {ev.actor_type !== "team" && ev.actor_name ? ` · ${ev.actor_name}` : ""}
                    {ev.body ? <span className="text-muted-foreground"> · {ev.body}</span> : null}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">
                    {shortDate(ev.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ───────── New link ───────── */
function NewShareView({ workspaceId, onDone }: { workspaceId: string | null; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [allowComments, setAllowComments] = useState(true);
  const [allowApprovals, setAllowApprovals] = useState(true);
  const [allowDownload, setAllowDownload] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState("14");
  const [password, setPassword] = useState("");
  const [showOptions, setShowOptions] = useState(false);

  const [content, setContent] = useState<ContentRow[] | null>(null);
  const [contentFailed, setContentFailed] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Guardrail findings the server wants acknowledged before sharing (409).
  const [review, setReview] = useState<ShareFinding[] | null>(null);

  const loadContent = useCallback(async () => {
    if (!workspaceId) return;
    setContentFailed(false);
    const { data, error } = await supabase
      .from("content_items")
      .select("id, title, body, channel, status, kind")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) setContentFailed(true);
    else setContent((data ?? []) as ContentRow[]);
  }, [workspaceId]);

  useEffect(() => {
    void loadContent();
  }, [loadContent]);

  const selected = (content ?? []).filter((c) => picked[c.id]);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link", url);
    }
  };

  const create = async (acknowledgeWarnings = false) => {
    if (!workspaceId || busy) return;
    if (!title.trim()) return void toast.error("Give the link a name");
    if (selected.length === 0) return void toast.error("Pick at least one post");
    if (password.trim() && password.trim().length < 8) {
      return void toast.error("The password needs at least 8 characters");
    }
    if (clientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail.trim())) {
      return void toast.error("Enter a valid client email");
    }

    setBusy(true);
    try {
      const days = Number(expiresInDays);
      const r = await post("create", {
        workspaceId,
        title: title.trim(),
        clientName: clientName.trim() || undefined,
        clientEmail: clientEmail.trim() || null,
        password: password.trim() || null,
        expiresAt: days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null,
        allowComments,
        allowApprovals,
        allowDownload,
        // The server copies each post from its own row; only the id matters.
        items: selected.map((c) => ({ kind: "content_item" as const, refId: c.id })),
        acknowledgeWarnings,
      });
      if (r.status === 409) {
        const body = (await r
          .clone()
          .json()
          .catch(() => null)) as {
          requiresAcknowledgement?: boolean;
          findings?: ShareFinding[];
        } | null;
        if (body?.requiresAcknowledgement) {
          setReview(body.findings ?? []);
          return;
        }
      }
      // A plan limit shows its own upgrade notice.
      if (r.status === 402) return;
      if (!r.ok) throw new Error(await errorText(r));
      const data = await r.json();
      setReview(null);
      setCreated({ url: data.url });
    } catch (e: any) {
      toast.error("Couldn't make the link", { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="ds-tile mx-auto max-w-lg p-6 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-primary/15 text-primary">
          <Check className="size-5" />
        </span>
        <p className="mt-3 text-[15px] font-semibold">Your link is ready</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {password.trim()
            ? "Send it to your client, and the password in a separate message."
            : "Send it to your client. They don't need an account."}
        </p>
        <div className="ds-well mt-4 flex items-center gap-2 py-1.5 pl-3.5 pr-1.5">
          <LinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            readOnly
            value={created.url}
            aria-label="Link for your client"
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 truncate bg-transparent text-[12.5px] outline-none"
          />
          <Button size="sm" onClick={() => copy(created.url)}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={created.url} target="_blank" rel="noopener noreferrer">
              See what they see
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={shareMailto(created.url, title.trim(), clientEmail.trim() || null)}>
              <Mail /> Email it
            </a>
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <FieldLabel htmlFor="share-title">Name</FieldLabel>
        <Input
          id="share-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Posts for next week"
          maxLength={200}
        />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <FieldLabel>Posts to share{selected.length ? ` · ${selected.length}` : ""}</FieldLabel>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setPicked({})}
              className="text-[12px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
        {contentFailed ? (
          <ErrorState
            size="sm"
            title="Couldn't load your posts"
            onRetry={() => void loadContent()}
          />
        ) : !content ? (
          <ListSkeleton />
        ) : content.length === 0 ? (
          <EmptyState
            size="sm"
            title="No posts yet"
            description="Make a post first, then share it here."
            action={
              <Button size="sm" onClick={() => emitAppEvent("open:create-launcher")}>
                Create
              </Button>
            }
          />
        ) : (
          <ul className="ds-tile max-h-[280px] divide-y divide-border/50 overflow-y-auto">
            {content.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 hover:bg-[var(--ds-well-bg)]">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-[hsl(var(--primary))]"
                    checked={!!picked[c.id]}
                    onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.checked }))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {c.title?.trim() || c.body?.slice(0, 70) || "Untitled"}
                    </span>
                    <span className="block truncate text-[12px] capitalize text-muted-foreground">
                      {[c.channel ?? c.kind, STATUS_WORDS[c.status] ?? c.status].join(" · ")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowOptions((v) => !v)}
          aria-expanded={showOptions}
          className="text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          {showOptions ? "Hide options" : "Options: password, expiry, what clients can do"}
        </button>
        {showOptions && (
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="share-client">Client name</FieldLabel>
                <Input
                  id="share-client"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Acme Co."
                />
              </div>
              <div>
                <FieldLabel htmlFor="share-email">Client email</FieldLabel>
                <Input
                  id="share-email"
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="hello@acme.com"
                />
              </div>
              <div>
                <FieldLabel>Link works for</FieldLabel>
                <Select value={expiresInDays} onValueChange={setExpiresInDays}>
                  <SelectTrigger aria-label="Link works for">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3 days</SelectItem>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="14">14 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="0">Always</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <FieldLabel htmlFor="share-password">Password</FieldLabel>
                <Input
                  id="share-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="None"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="ds-tile divide-y divide-border/50">
              <Toggle
                label="Clients can approve"
                value={allowApprovals}
                onChange={setAllowApprovals}
              />
              <Toggle
                label="Clients can comment"
                value={allowComments}
                onChange={setAllowComments}
              />
              <Toggle
                label="Clients can download"
                value={allowDownload}
                onChange={setAllowDownload}
              />
            </div>
          </div>
        )}
      </div>

      {review && (
        <div role="alert" className="ds-tile border-warning/40 p-4 text-[12.5px]">
          <p className="text-[13px] font-semibold">Check these before your client sees them</p>
          <ul className="mt-2 space-y-1.5">
            {review.slice(0, 8).map((f, i) => (
              <li key={i} className="flex gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    f.severity === "block" ? "bg-destructive" : "bg-warning",
                  )}
                />
                <span className="min-w-0">
                  <span className="font-medium">{f.itemTitle}</span>
                  <span className="text-muted-foreground"> · {f.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReview(null)}>
              Go back
            </Button>
            <Button size="sm" variant="outline" onClick={() => create(true)} loading={busy}>
              Share anyway
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => create()}
          loading={busy}
          disabled={!title.trim() || selected.length === 0}
        >
          Make link
        </Button>
      </div>
    </div>
  );
}

/* ───────── Links ───────── */
function ManageView({ portal, onNew }: { portal: Portal; onNew: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; what: "rotate" | "off" } | null>(null);

  /** Ask the server for the share's link. link = same link; rotate = new one. */
  const fetchLink = async (
    shareId: string,
    action: "link" | "rotate" | "reactivate",
  ): Promise<{ url: string; rotated: boolean }> => {
    const r = await post(action, { shareId });
    if (!r.ok) throw new Error(await errorText(r));
    const data = await r.json();
    return { url: data.url, rotated: Boolean(data.rotated) };
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const run = async (id: string, failure: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(id);
    setConfirm(null);
    try {
      await work();
    } catch (e: any) {
      toast.error(failure, { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const copyLink = (s: ShareRow) =>
    run(s.id, "Couldn't get the link", async () => {
      const { url, rotated } = await fetchLink(s.id, "link");
      if (!(await copyText(url))) return void window.prompt("Copy this link", url);
      setCopiedId(s.id);
      setTimeout(() => setCopiedId(null), 1500);
      if (rotated) {
        toast.success("Link copied", {
          description: "This is a new link. The old one no longer works.",
        });
      }
    });

  const emailLink = (s: ShareRow) =>
    run(s.id, "Couldn't get the link", async () => {
      const { url } = await fetchLink(s.id, "link");
      window.location.href = shareMailto(url, s.title, s.client_email);
    });

  const rotateLink = (s: ShareRow) =>
    run(s.id, "Couldn't make a new link", async () => {
      const { url } = await fetchLink(s.id, "rotate");
      const copied = await copyText(url);
      toast.success("New link made", {
        description: copied
          ? "Copied. The old link no longer works."
          : "The old link no longer works.",
      });
    });

  const turnOff = (s: ShareRow) =>
    run(s.id, "Couldn't turn the link off", async () => {
      const r = await post("revoke", { shareId: s.id });
      if (!r.ok) throw new Error(await errorText(r));
      toast.success("Link turned off", { description: "Your client can no longer open it." });
      await portal.refresh();
    });

  const turnOn = (s: ShareRow) =>
    run(s.id, "Couldn't turn the link back on", async () => {
      const { url, rotated } = await fetchLink(s.id, "reactivate");
      const copied = await copyText(url);
      toast.success("Link is on again", {
        description: rotated
          ? "This is a new link. Send it to your client."
          : copied
            ? "Link copied."
            : undefined,
      });
      await portal.refresh();
    });

  if (!portal.loaded) {
    return portal.failed ? (
      <ErrorState
        size="sm"
        title="Couldn't load your links"
        onRetry={() => void portal.refresh()}
      />
    ) : (
      <ListSkeleton />
    );
  }

  if (portal.shares.length === 0) {
    return (
      <EmptyState
        icon={LinkIcon}
        title="No links yet"
        description="Make a link to show a client your posts."
        action={<Button onClick={onNew}>Make a link</Button>}
      />
    );
  }

  return (
    <ul className="space-y-2">
      {portal.shares.map((s) => {
        const on = s.status === "active";
        const expired = on && !!s.expires_at && new Date(s.expires_at) < new Date();
        const working = busy === s.id;
        const asking = confirm?.id === s.id ? confirm.what : null;
        return (
          <li key={s.id} className={cn("ds-tile p-3.5", !on && "opacity-70")}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="flex items-center gap-2 text-[13.5px] font-semibold">
                  <span className="truncate">{s.title}</span>
                  {(expired || !on) && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-medium",
                        expired
                          ? "bg-warning/15 text-warning"
                          : "bg-[var(--ds-well-bg)] text-muted-foreground",
                      )}
                    >
                      {expired ? "Expired" : "Off"}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                  {[
                    s.client_name,
                    s.last_viewed_at ? `Opened ${shortDate(s.last_viewed_at)}` : "Not opened yet",
                    s.expires_at && !expired
                      ? `Until ${new Date(s.expires_at).toLocaleDateString([], { month: "short", day: "numeric" })}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              {asking ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="text-[12px] text-muted-foreground">
                    {asking === "rotate"
                      ? "The old link will stop working."
                      : "Turn this link off?"}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={working}
                    onClick={() => (asking === "rotate" ? rotateLink(s) : turnOff(s))}
                  >
                    {asking === "rotate" ? "Make new link" : "Turn off"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                </div>
              ) : on ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" loading={working} onClick={() => copyLink(s)}>
                    {copiedId === s.id ? "Copied" : "Copy link"}
                  </Button>
                  <button
                    type="button"
                    className={dsIconBtn}
                    disabled={!!busy}
                    onClick={() => emailLink(s)}
                    title="Email the link"
                    aria-label={`Email the link for ${s.title}`}
                  >
                    <Mail className="size-4" />
                  </button>
                  <button
                    type="button"
                    className={dsIconBtn}
                    disabled={!!busy}
                    onClick={() => setConfirm({ id: s.id, what: "rotate" })}
                    title="Make a new link"
                    aria-label={`Make a new link for ${s.title}`}
                  >
                    <RefreshCw className="size-4" />
                  </button>
                  <button
                    type="button"
                    className={cn(dsIconBtn, "hover:text-destructive")}
                    disabled={!!busy}
                    onClick={() => setConfirm({ id: s.id, what: "off" })}
                    title="Turn the link off"
                    aria-label={`Turn off the link for ${s.title}`}
                  >
                    <Power className="size-4" />
                  </button>
                </div>
              ) : (
                <Button size="sm" variant="outline" loading={working} onClick={() => turnOn(s)}>
                  Turn on
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ───────── Helpers ───────── */
/** A readable message from a failed /api/shares response. */
async function errorText(r: Response): Promise<string> {
  const text = await r.text().catch(() => "");
  try {
    const data = JSON.parse(text) as { error?: unknown; message?: unknown };
    const msg = data.error ?? data.message;
    if (typeof msg === "string" && msg) return msg;
  } catch {
    // not JSON
  }
  if (r.status === 403) return "You need editor access to do this.";
  return "Something went wrong. Try again.";
}

/** A mailto: link that opens the user's own email app with the link filled in. */
function shareMailto(url: string, title: string, to: string | null): string {
  const subject = title ? `For your review: ${title}` : "For your review";
  const body = [
    "Hi,",
    "",
    "Here is the link to review:",
    url,
    "",
    "You can approve, ask for changes or leave comments there.",
  ].join("\n");
  return `mailto:${to ? encodeURIComponent(to) : ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* ───────── Atoms ───────── */
function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-medium text-foreground/80">
      {children}
    </label>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]">
      {label}
      <Switch checked={value} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}
