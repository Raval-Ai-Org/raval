"use client";

import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { appendNote } from "@/lib/notes-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Users,
  Link as LinkIcon,
  Copy,
  Check,
  Inbox,
  Plus,
  Loader2,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  Lightbulb,
  Calendar,
  FileText,
  Search,
  Trash2,
  MessageSquare,
  Eye,
  Mail,
  RefreshCw,
} from "@/components/ui/gemini-icons";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
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
  scheduled_at: string | null;
  hashtags: string[] | null;
  media_url: string | null;
  updated_at: string;
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
  actor_email: string | null;
  marketer_decision: string;
  actor_type?: "client" | "team";
  marketer_read_at?: string | null;
  client_read_at?: string | null;
  created_at: string;
};

const EVENT_META: Record<string, { icon: any; tone: string; label: string }> = {
  approved: { icon: ThumbsUp, tone: "text-emerald-600", label: "Approved" },
  rejected: { icon: ThumbsDown, tone: "text-red-600", label: "Rejected" },
  requested_changes: { icon: MessageSquare, tone: "text-amber-600", label: "Changes requested" },
  suggested: { icon: Lightbulb, tone: "text-[hsl(var(--brand-blue))]", label: "Suggestion" },
  commented: { icon: MessageSquare, tone: "text-foreground/80", label: "Comment" },
  viewed: { icon: Eye, tone: "text-muted-foreground", label: "Viewed" },
  replied: { icon: MessageSquare, tone: "text-foreground/80", label: "Your team replied" },
};

/**
 * The client portal. Opened by the "open:client-portal" app event (sidebar,
 * Share menu, chat tools, Studio suggestions); AppShell mounts it once.
 */
export function ClientPortalDialog({ workspaceId }: { workspaceId: string | null }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"share" | "inbox" | "manage">("inbox");
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const h = () => setOpen(true);
    addAppEventListener("open:client-portal", h);
    return () => removeAppEventListener("open:client-portal", h);
  }, []);

  // Pending count for the Inbox tab badge, refreshed while the dialog is open.
  useEffect(() => {
    if (!workspaceId || !open) return;
    let cancel = false;
    const load = async () => {
      try {
        const r = await authedFetch("/api/shares?action=list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId }),
        });
        if (!r.ok) return;
        const data = await r.json();
        if (cancel) return;
        const p = (data.events ?? []).filter(
          (e: EventRow) =>
            e.actor_type !== "team" && e.marketer_decision === "pending" && e.kind !== "viewed",
        ).length;
        setPending(p);
      } catch {}
    };
    load();
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, 30_000);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [workspaceId, open]);

  const tabs = [
    {
      id: "inbox" as const,
      label: "Inbox",
      icon: Inbox,
      badge: pending,
      hint: "Decide on client feedback",
    },
    { id: "share" as const, label: "New share", icon: Plus, badge: 0, hint: "Build a review link" },
    {
      id: "manage" as const,
      label: "Links",
      icon: ShieldCheck,
      badge: 0,
      hint: "Your share links",
    },
  ];

  return (
    <>
      <AppModalShell
        open={open}
        onOpenChange={setOpen}
        size="lg"
        Icon={Users}
        title="Share your work. Stay in control."
        description="Send drafts to clients to approve"
      >
        <div className="px-5 sm:px-6 pt-4">
          <div className="inline-flex w-full sm:w-auto items-center gap-0.5 rounded-full border border-border/60 bg-background/70 p-1 backdrop-blur-md shadow-sm">
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  title={t.hint}
                  className={cn(
                    "relative inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                    active ? "text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="client-tab-active"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      className="absolute inset-0 rounded-full bg-gradient-to-r from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] shadow-[0_4px_14px_-4px_hsl(var(--brand-green)/0.55)]"
                    />
                  )}
                  <t.icon className="relative h-3.5 w-3.5" />
                  <span className="relative">{t.label}</span>
                  {t.badge > 0 && (
                    <motion.span
                      layout
                      className={cn(
                        "relative grid h-4 min-w-[16px] place-items-center rounded-full px-1 text-[9.5px] font-semibold tabular-nums",
                        active
                          ? "bg-background/25 text-background"
                          : "bg-[hsl(var(--brand-green))] text-background",
                      )}
                    >
                      {t.badge}
                    </motion.span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-5 sm:px-6 py-5">
          <AnimatePresence mode="wait" initial={false}>
            {tab === "inbox" && (
              <motion.div
                key="inbox"
                initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <InboxView workspaceId={workspaceId} onPendingChange={setPending} />
              </motion.div>
            )}
            {tab === "share" && (
              <motion.div
                key="share"
                initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <NewShareView workspaceId={workspaceId} onCreated={() => setTab("manage")} />
              </motion.div>
            )}
            {tab === "manage" && (
              <motion.div
                key="manage"
                initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <ManageView workspaceId={workspaceId} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </AppModalShell>
    </>
  );
}

/* ───────── Inbox ───────── */
function InboxView({
  workspaceId,
  onPendingChange,
}: {
  workspaceId: string | null;
  onPendingChange: (count: number) => void;
}) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const r = await authedFetch("/api/shares?action=list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!r.ok) return;
      const data = await r.json();
      setEvents(data.events ?? []);
      setShares(data.shares ?? []);
    } catch {
      // Keep the last good list; the next poll retries.
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!workspaceId) return;
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
  }, [refresh, workspaceId]);

  const decide = async (eventId: string, decision: "accepted" | "dismissed" | "applied") => {
    setBusy(eventId);
    try {
      const r = await authedFetch("/api/shares?action=decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, decision }),
      });
      if (!r.ok) throw new Error(await errorText(r));
      toast.success(
        decision === "accepted" ? "Accepted" : decision === "applied" ? "Applied" : "Dismissed",
      );
      refresh();
    } catch (e: any) {
      toast.error("Couldn't update", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const saveToMemory = async (ev: EventRow) => {
    if (!workspaceId) return;
    setBusy(ev.id);
    try {
      // Written straight to the workspace's notes so it is kept even when the
      // Notes panel isn't open; a mounted panel refreshes via notes:changed.
      const text = [`Client suggestion · ${ev.actor_name ?? "client"}`, ev.body ?? ""]
        .filter(Boolean)
        .join("\n\n");
      if (!appendNote(workspaceId, { text, color: "sky" })) {
        toast.error("Couldn't save to Memory", {
          description: "Browser storage is unavailable.",
        });
        return;
      }
      await decide(ev.id, "applied");
      toast.success("Saved to Memory");
    } finally {
      setBusy(null);
    }
  };

  const reply = async (shareId: string) => {
    if (!replyText.trim()) return;
    setBusy(`reply:${shareId}`);
    try {
      const r = await authedFetch("/api/shares?action=reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId, body: replyText.trim() }),
      });
      if (!r.ok) throw new Error(await errorText(r));
      setReplyText("");
      setReplyTo(null);
      toast.success("Reply sent to the client");
      refresh();
    } catch (e: any) {
      toast.error("Couldn't send reply", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const pending = events.filter(
    (e) => e.actor_type !== "team" && e.marketer_decision === "pending" && e.kind !== "viewed",
  );
  const recent = events
    .filter((e) => e.marketer_decision !== "pending" || e.kind === "viewed")
    .slice(0, 20);
  const sharesById = useMemo(() => Object.fromEntries(shares.map((s) => [s.id, s])), [shares]);

  useEffect(() => {
    onPendingChange(pending.length);
  }, [pending.length, onPendingChange]);

  if (loading && events.length === 0) {
    return <LoadingIndicator label="Loading activity" className="py-12" />;
  }

  return (
    <div className="space-y-4">
      <section>
        <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Awaiting your decision · {pending.length}
        </div>
        {pending.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative overflow-hidden rounded-2xl border border-dashed border-border/60 bg-gradient-to-br from-[hsl(var(--brand-blue)/0.04)] to-[hsl(var(--brand-green)/0.05)] py-8 text-center"
          >
            <div className="flex flex-col items-center gap-2">
              <div className="text-[13px] font-medium">All caught up</div>
              <div className="text-[11.5px] text-muted-foreground max-w-xs">
                No pending approvals or suggestions. When clients act, you'll see it land here.
              </div>
            </div>
          </motion.div>
        ) : (
          <div className="space-y-2">
            {pending.map((ev, i) => {
              const meta = EVENT_META[ev.kind] ?? EVENT_META.commented;
              const Icon = meta.icon;
              const share = sharesById[ev.share_id];
              return (
                <motion.div
                  key={ev.id}
                  layout
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -20, scale: 0.96 }}
                  transition={{ delay: i * 0.04, type: "spring", stiffness: 300, damping: 26 }}
                  className="group relative overflow-hidden rounded-xl border border-border/60 bg-card p-3.5 transition-shadow hover:shadow-[0_4px_18px_-8px_hsl(var(--brand-green)/0.25)]"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b",
                      ev.kind === "approved"
                        ? "from-emerald-400 to-emerald-600"
                        : ev.kind === "rejected"
                          ? "from-red-400 to-red-600"
                          : ev.kind === "suggested"
                            ? "from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))]"
                            : "from-amber-400 to-amber-600",
                    )}
                  />
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-secondary",
                        meta.tone,
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[12.5px]">
                        <span className={cn("font-semibold", meta.tone)}>{meta.label}</span>
                        <span className="text-muted-foreground">
                          by {ev.actor_name ?? "client"}
                        </span>
                        {share && <span className="text-muted-foreground">· {share.title}</span>}
                        <span className="ml-auto text-[10.5px] text-muted-foreground">
                          {new Date(ev.created_at).toLocaleString()}
                        </span>
                      </div>
                      {ev.body && (
                        <p className="mt-1.5 text-[13px] whitespace-pre-wrap">{ev.body}</p>
                      )}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        {ev.kind === "suggested" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => saveToMemory(ev)}
                              loading={busy === ev.id}
                            >
                              <Lightbulb className="h-3.5 w-3.5 mr-1" /> Save to Memory
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => decide(ev.id, "dismissed")}
                              loading={busy === ev.id}
                            >
                              Dismiss
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={() => decide(ev.id, "accepted")}
                              loading={busy === ev.id}
                            >
                              <Check className="h-3.5 w-3.5 mr-1" /> Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => decide(ev.id, "dismissed")}
                              loading={busy === ev.id}
                            >
                              Dismiss
                            </Button>
                          </>
                        )}
                        {share && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setReplyTo(replyTo === share.id ? null : share.id)}
                          >
                            Reply
                          </Button>
                        )}
                      </div>
                      {share && replyTo === share.id && (
                        <div className="mt-2 flex gap-2">
                          <Textarea
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            rows={2}
                            placeholder="Reply to the client"
                            className="text-[12px]"
                          />
                          <Button
                            size="sm"
                            onClick={() => reply(share.id)}
                            disabled={!replyText.trim()}
                            loading={busy === `reply:${share.id}`}
                          >
                            Send
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Activity
          </div>
          <div className="rounded-xl border border-border/60 divide-y divide-border/40">
            {recent.map((ev) => {
              const meta = EVENT_META[ev.kind] ?? EVENT_META.commented;
              const Icon = meta.icon;
              return (
                <div key={ev.id} className="flex items-center gap-2.5 px-3 py-2 text-[12px]">
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.tone)} />
                  <span className="truncate">
                    <span className={cn("font-medium", meta.tone)}>{meta.label}</span>
                    {ev.actor_name ? ` by ${ev.actor_name}` : ""}
                    {ev.body ? ` — ${ev.body.slice(0, 80)}` : ""}
                  </span>
                  <span className="ml-auto text-[10.5px] text-muted-foreground shrink-0">
                    {new Date(ev.created_at).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/* ───────── New share ───────── */
function NewShareView({
  workspaceId,
  onCreated,
}: {
  workspaceId: string | null;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [allowComments, setAllowComments] = useState(true);
  const [allowApprovals, setAllowApprovals] = useState(true);
  const [allowDownload, setAllowDownload] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState<number>(14);
  const [password, setPassword] = useState("");

  const [content, setContent] = useState<ContentRow[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [loadingContent, setLoadingContent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ url: string; slug: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Guardrail findings the server wants acknowledged before sharing (409).
  const [review, setReview] = useState<ShareFinding[] | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    setLoadingContent(true);
    supabase
      .from("content_items")
      .select(
        "id, title, body, channel, status, kind, scheduled_at, hashtags, media_url, updated_at",
      )
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setContent((data ?? []) as any);
        setLoadingContent(false);
      });
  }, [workspaceId]);

  const selectedCount = Object.values(picked).filter(Boolean).length;

  const create = async (acknowledgeWarnings = false) => {
    if (!workspaceId) return;
    if (!title.trim()) {
      toast.error("Add a title");
      return;
    }
    const items = content
      .filter((c) => picked[c.id])
      .map((c) => ({
        kind: "content_item" as const,
        refId: c.id,
        title: c.title ?? "Untitled",
        description: c.body?.slice(0, 200) ?? "",
        snapshot: {
          body: c.body,
          channel: c.channel,
          kind: c.kind,
          scheduled_at: c.scheduled_at,
          hashtags: c.hashtags,
          media_url: c.media_url,
        },
      }));
    if (items.length === 0) {
      toast.error("Pick at least one item to share");
      return;
    }
    if (password.trim() && password.trim().length < 8) {
      toast.error("Password needs at least 8 characters");
      return;
    }
    if (clientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail.trim())) {
      toast.error("Enter a valid client email");
      return;
    }

    setBusy(true);
    try {
      const expiresAt =
        expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 86400_000).toISOString() : null;
      const r = await authedFetch("/api/shares?action=create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          title: title.trim(),
          clientName: clientName.trim() || undefined,
          clientEmail: clientEmail.trim() || null,
          password: password.trim() || null,
          expiresAt,
          allowComments,
          allowApprovals,
          allowDownload,
          items,
          acknowledgeWarnings,
        }),
      });
      if (r.status === 409) {
        const body = (await r.json().catch(() => null)) as {
          requiresAcknowledgement?: boolean;
          findings?: ShareFinding[];
        } | null;
        if (body?.requiresAcknowledgement) {
          setReview(body.findings ?? []);
          return;
        }
      }
      if (!r.ok) throw new Error(await errorText(r));
      const data = await r.json();
      setReview(null);
      setCreated({ url: data.url, slug: data.slug });
      try {
        await navigator.clipboard.writeText(data.url);
        setCopied(true);
      } catch {}
      toast.success("Share link created — copied to clipboard");
    } catch (e: any) {
      toast.error("Couldn't create share", { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-center">
          <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-emerald-500/15 text-emerald-600">
            <Check className="h-5 w-5" />
          </div>
          <div className="text-[14px] font-semibold">Share ready</div>
          <div className="text-[12px] text-muted-foreground">Send this link to your client.</div>
          <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-border/60 bg-background px-2.5 py-1.5">
            <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              readOnly
              value={created.url}
              className="flex-1 truncate bg-transparent text-[12px] outline-none"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(created.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {}
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {password.trim() && (
            <div className="mt-2 text-[11.5px] text-muted-foreground">
              Send the password separately.
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => window.open(created.url, "_blank")}>
              Preview as client
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={shareMailto(created.url, title.trim(), clientEmail.trim() || null)}>
                <Mail className="h-3.5 w-3.5 mr-1" /> Email to client
              </a>
            </Button>
            <Button size="sm" onClick={onCreated}>
              Done
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <Label>Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Acme — week of June 30"
          />
        </div>
        <div>
          <Label>Client name (optional)</Label>
          <Input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Acme Co."
          />
        </div>
        <div>
          <Label>Client email (optional)</Label>
          <Input
            value={clientEmail}
            onChange={(e) => setClientEmail(e.target.value)}
            placeholder="hello@acme.com"
          />
        </div>
        <div>
          <Label>Expires in</Label>
          <select
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(Number(e.target.value))}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-[13px] outline-none focus:ring-1 focus:ring-ring"
          >
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={0}>Never</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <Label>Password (optional)</Label>
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave blank for link-only access"
            type="text"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Toggle label="Allow approvals" value={allowApprovals} onChange={setAllowApprovals} />
        <Toggle label="Allow comments" value={allowComments} onChange={setAllowComments} />
        <Toggle label="Allow download" value={allowDownload} onChange={setAllowDownload} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <Label>
            What to share <span className="text-muted-foreground">({selectedCount} picked)</span>
          </Label>
          <button
            onClick={() =>
              setPicked(Object.fromEntries(content.slice(0, 10).map((c) => [c.id, true])))
            }
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Pick latest 10
          </button>
        </div>
        {loadingContent ? (
          <LoadingIndicator label="Loading content" size="sm" className="py-6" />
        ) : content.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 py-6 text-center text-[12.5px] text-muted-foreground">
            No content yet — draft a post first.
          </div>
        ) : (
          <div className="max-h-[300px] overflow-y-auto rounded-xl border border-border/60 divide-y divide-border/40">
            {content.map((c) => {
              const Icon =
                c.kind === "post"
                  ? Sparkles
                  : c.kind === "blog"
                    ? FileText
                    : c.kind === "brief"
                      ? Search
                      : c.kind === "email"
                        ? FileText
                        : Calendar;
              return (
                <label
                  key={c.id}
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-secondary/40 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={!!picked[c.id]}
                    onChange={(e) => setPicked((p) => ({ ...p, [c.id]: e.target.checked }))}
                  />
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium">
                      {c.title ?? c.body?.slice(0, 60) ?? "Untitled"}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {c.channel ?? c.kind} · {c.status}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {review && (
        <div
          role="alert"
          className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-[12px]"
        >
          <div className="font-semibold text-amber-700 dark:text-amber-400">
            Review before sharing with your client
          </div>
          <p className="mt-0.5 text-muted-foreground">
            These items contain things a client shouldn&apos;t see unchecked. Edit them, or share
            anyway if you&apos;ve confirmed they&apos;re fine.
          </p>
          <ul className="mt-2 space-y-1">
            {review.slice(0, 8).map((f, i) => (
              <li key={i} className="flex gap-2">
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase",
                    f.severity === "block"
                      ? "bg-red-500/15 text-red-600"
                      : "bg-amber-500/15 text-amber-700",
                  )}
                >
                  {f.severity === "block" ? "Blocker" : "Warning"}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">{f.itemTitle}</span>
                  <span className="text-muted-foreground"> · {f.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setReview(null)}>
              Go back and edit
            </Button>
            <Button size="sm" variant="outline" onClick={() => create(true)} loading={busy}>
              Share anyway
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-3">
        <Button onClick={() => create()} disabled={busy || !title.trim() || selectedCount === 0}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <LinkIcon className="h-4 w-4 mr-2" />
          )}
          Create share link
        </Button>
      </div>
    </div>
  );
}

/* ───────── Manage ───────── */
function ManageView({ workspaceId }: { workspaceId: string | null }) {
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const r = await authedFetch("/api/shares?action=list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (!r.ok) throw new Error(await errorText(r));
      const data = await r.json();
      setShares(data.shares ?? []);
    } catch (e: any) {
      toast.error("Couldn't load share links", { description: e?.message });
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const revoke = async (shareId: string) => {
    setBusy(shareId);
    try {
      const r = await authedFetch("/api/shares?action=revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId }),
      });
      if (!r.ok) throw new Error(await errorText(r));
      toast.success("Link turned off", { description: "Your client can no longer open it." });
      refresh();
    } catch (e: any) {
      toast.error("Couldn't turn the link off", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const [confirmRotate, setConfirmRotate] = useState<string | null>(null);

  /** Ask the server for the share's link. link = same link; rotate = new one. */
  const fetchLink = async (
    shareId: string,
    action: "link" | "rotate" | "reactivate",
  ): Promise<{ url: string; rotated: boolean }> => {
    const r = await authedFetch(`/api/shares?action=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareId }),
    });
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

  const reactivate = async (shareId: string) => {
    setBusy(shareId);
    try {
      const { url, rotated } = await fetchLink(shareId, "reactivate");
      const copied = await copyText(url);
      toast.success("Link is on again", {
        description: rotated
          ? "This is a new link. Send it to your client."
          : copied
            ? "Link copied."
            : undefined,
      });
      refresh();
    } catch (e: any) {
      toast.error("Couldn't turn the link back on", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async (s: ShareRow) => {
    setBusy(s.id);
    try {
      const { url, rotated } = await fetchLink(s.id, "link");
      if (!(await copyText(url))) {
        window.prompt("Copy this link", url);
        return;
      }
      setCopiedId(s.id);
      setTimeout(() => setCopiedId(null), 1500);
      toast.success("Link copied", {
        description: rotated ? "This is a new link. The old one no longer works." : undefined,
      });
    } catch (e: any) {
      toast.error("Couldn't get the link", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const rotateLink = async (s: ShareRow) => {
    setBusy(s.id);
    setConfirmRotate(null);
    try {
      const { url } = await fetchLink(s.id, "rotate");
      const copied = await copyText(url);
      toast.success("New link made", {
        description: copied
          ? "Copied. The old link no longer works."
          : "The old link no longer works.",
      });
    } catch (e: any) {
      toast.error("Couldn't make a new link", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const emailLink = async (s: ShareRow) => {
    setBusy(s.id);
    try {
      const { url } = await fetchLink(s.id, "link");
      window.location.href = shareMailto(url, s.title, s.client_email);
    } catch (e: any) {
      toast.error("Couldn't get the link", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  if (loading && shares.length === 0) {
    return <LoadingIndicator label="Loading share links" className="py-12" />;
  }

  if (shares.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative overflow-hidden rounded-2xl border border-dashed border-border/60 bg-gradient-to-br from-[hsl(var(--brand-blue)/0.04)] to-[hsl(var(--brand-green)/0.05)] py-10 text-center"
      >
        <div className="flex flex-col items-center gap-2">
          <div className="text-[13.5px] font-medium">No shares yet</div>
          <div className="text-[11.5px] text-muted-foreground max-w-xs">
            Switch to <span className="text-foreground font-medium">New share</span> to build a
            branded review link for your client.
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="space-y-2">
      {shares.map((s) => (
        <motion.div
          key={s.id}
          layout
          className={cn(
            "rounded-xl border bg-card p-3.5",
            s.status === "active" ? "border-border/60" : "border-border/30 opacity-60",
          )}
        >
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
              <Users className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                {s.title}
                {s.status === "active" && s.expires_at && new Date(s.expires_at) < new Date() && (
                  <span className="text-[10px] uppercase tracking-wide text-amber-600">
                    Expired
                  </span>
                )}
                {s.status !== "active" && (
                  <span className="text-[10px] uppercase tracking-wide text-red-600">Off</span>
                )}
              </div>
              <div className="text-[11.5px] text-muted-foreground">
                {s.client_name ? `${s.client_name} · ` : ""}
                {s.view_count > 0 ? `${s.view_count} views` : "Never viewed"}
                {s.last_viewed_at ? ` · last ${new Date(s.last_viewed_at).toLocaleString()}` : ""}
                {s.expires_at ? ` · expires ${new Date(s.expires_at).toLocaleDateString()}` : ""}
              </div>
              <div className="mt-1.5 flex items-center gap-1 text-[10.5px] text-muted-foreground">
                {s.allow_approvals && <Badge>Approvals</Badge>}
                {s.allow_comments && <Badge>Comments</Badge>}
                {s.allow_download && <Badge>Download</Badge>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {s.status === "active" && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copyLink(s)}
                    disabled={busy === s.id}
                    title="Copy link"
                    aria-label={`Copy link for ${s.title}`}
                  >
                    {copiedId === s.id ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => emailLink(s)}
                    loading={busy === s.id}
                    title="Email link"
                    aria-label={`Email link for ${s.title}`}
                  >
                    <Mail className="h-3.5 w-3.5" />
                  </Button>
                  {confirmRotate === s.id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => rotateLink(s)}
                      loading={busy === s.id}
                      title="The old link will stop working"
                    >
                      Make new link?
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmRotate(s.id)}
                      loading={busy === s.id}
                      title="New link (the old one stops working)"
                      aria-label={`New link for ${s.title}`}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </>
              )}
              {s.status === "active" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => revoke(s.id)}
                  loading={busy === s.id}
                  title="Turn link off"
                  aria-label={`Turn off link for ${s.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reactivate(s.id)}
                  loading={busy === s.id}
                  title="Turn link back on"
                >
                  Turn on
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      ))}
    </div>
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
  return text.slice(0, 200) || `Request failed (${r.status})`;
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
function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </div>
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
    <div
      role="button"
      tabIndex={0}
      onClick={() => onChange(!value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onChange(!value);
        }
      }}
      className={cn(
        "flex items-center justify-between rounded-lg border px-3 py-2 text-[12px] transition",
        value
          ? "border-foreground/20 bg-card"
          : "border-border/60 bg-background text-muted-foreground",
      )}
    >
      <span>{label}</span>
      <Switch
        checked={value}
        onCheckedChange={onChange}
        onClick={(event) => event.stopPropagation()}
        aria-label={label}
      />
    </div>
  );
}
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border/60 bg-background px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wide">
      {children}
    </span>
  );
}
