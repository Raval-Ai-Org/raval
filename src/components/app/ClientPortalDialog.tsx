"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";
import { Slot } from "@radix-ui/react-slot";
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
  Calendar,
  FileText,
  Search,
  Trash2,
  Lightbulb,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Eye,
} from "@/components/ui/gemini-icons";
import { StarAgent } from "@/components/StarAgent";
import { LoadingIndicator } from "@/components/ui/loading-indicator";
import { cn } from "@/lib/utils";

// Matches the other top-bar pills (Schedule, Brand DNA) for visual cohesion.
const PILL =
  "group relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-2.5 sm:px-3 text-[12px] font-medium text-foreground/80 backdrop-blur-md transition-[transform,box-shadow,background-color,border-color,color] duration-200 ease-out hover:-translate-y-px hover:border-foreground/20 hover:bg-card hover:text-foreground hover:shadow-[0_4px_12px_-6px_rgba(0,0,0,0.12)] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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
  created_at: string;
};

const EVENT_META: Record<string, { icon: any; tone: string; label: string }> = {
  approved: { icon: ThumbsUp, tone: "text-emerald-600", label: "Approved" },
  rejected: { icon: ThumbsDown, tone: "text-red-600", label: "Rejected" },
  requested_changes: { icon: MessageSquare, tone: "text-amber-600", label: "Changes requested" },
  suggested: { icon: Lightbulb, tone: "text-[hsl(var(--brand-blue))]", label: "Suggestion" },
  commented: { icon: MessageSquare, tone: "text-foreground/80", label: "Comment" },
  viewed: { icon: Eye, tone: "text-muted-foreground", label: "Viewed" },
};

export function ClientPortalButton({ workspaceId }: { workspaceId: string | null }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"share" | "inbox" | "manage">("inbox");
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("open:client-portal", h);
    return () => window.removeEventListener("open:client-portal", h);
  }, []);

  // Poll pending count cheap
  useEffect(() => {
    if (!workspaceId) return;
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
          (e: EventRow) => e.marketer_decision === "pending" && e.kind !== "viewed",
        ).length;
        setPending(p);
      } catch {}
    };
    load();
    // Only poll while the dialog is open AND tab is visible.
    const id = open
      ? setInterval(() => {
          if (!document.hidden) load();
        }, 60_000)
      : null;
    return () => {
      cancel = true;
      if (id) clearInterval(id);
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
      { id: "share" as const, label: "New Review", icon: Plus, badge: 0, hint: "Build a review link" },
    {
      id: "manage" as const,
      label: "Manage",
      icon: ShieldCheck,
      badge: 0,
      hint: "Active share links",
    },
  ];

  return (
    <>
      <Slot onClick={() => setOpen(true)}>
        <button className={PILL} title="Client portal — share for approval">
          <Users className="h-3.5 w-3.5 transition-colors group-hover:text-[hsl(var(--brand-green))]" />
          <span className="hidden md:inline">Clients</span>
          <AnimatePresence>
            {pending > 0 && (
              <motion.span
                key="badge"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 22 }}
                className="relative grid h-4 min-w-[16px] place-items-center rounded-full bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] px-1 text-[9.5px] font-semibold tabular-nums text-background shadow-[0_0_0_2px_hsl(var(--background)),0_0_12px_-2px_hsl(var(--brand-green)/0.7)]"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full bg-[hsl(var(--brand-green))] opacity-50 animate-ping"
                />
                <span className="relative">{pending}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </Slot>
      <AppModalShell
        open={open}
        onOpenChange={setOpen}
        size="lg"
        Icon={Users}
        eyebrow="Client portal"
        title="Share your work. Stay in control."
        description="Send drafts to clients for review. They can approve, suggest, or reject — nothing changes in your workspace until you confirm."
        headerAccessory={
          <div className="hidden sm:block shrink-0">
            <StarAgent
              mood={pending > 0 ? "excited" : "happy"}
              size={56}
              hue={pending > 0 ? 151 : 217}
            />
          </div>
        }
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
                <InboxView workspaceId={workspaceId} />
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
function InboxView({ workspaceId }: { workspaceId: string | null }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const r = await authedFetch("/api/shares?action=list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const data = await r.json();
      setEvents(data.events ?? []);
      setShares(data.shares ?? []);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const decide = async (eventId: string, decision: "accepted" | "dismissed" | "applied") => {
    setBusy(eventId);
    try {
      const r = await authedFetch("/api/shares?action=decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, decision }),
      });
      if (!r.ok) throw new Error(await r.text());
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
    setBusy(ev.id);
    try {
      // Use existing memory note bus
      const note = {
        id: crypto.randomUUID(),
        title: `Client suggestion · ${ev.actor_name ?? "client"}`,
        body: ev.body ?? "",
        createdAt: Date.now(),
        source: "client" as const,
      };
      window.dispatchEvent(new CustomEvent("memory:add-note", { detail: note }));
      await decide(ev.id, "applied");
      toast.success("Saved to Memory");
    } finally {
      setBusy(null);
    }
  };

  const pending = events.filter((e) => e.marketer_decision === "pending" && e.kind !== "viewed");
  const recent = events
    .filter((e) => e.marketer_decision !== "pending" || e.kind === "viewed")
    .slice(0, 20);
  const sharesById = useMemo(() => Object.fromEntries(shares.map((s) => [s.id, s])), [shares]);

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
              <StarAgent mood="happy" size={60} hue={151} />
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
                              disabled={busy === ev.id}
                            >
                              <Lightbulb className="h-3.5 w-3.5 mr-1" /> Save to Memory
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => decide(ev.id, "dismissed")}
                              disabled={busy === ev.id}
                            >
                              Dismiss
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={() => decide(ev.id, "accepted")}
                              disabled={busy === ev.id}
                            >
                              <Check className="h-3.5 w-3.5 mr-1" /> Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => decide(ev.id, "dismissed")}
                              disabled={busy === ev.id}
                            >
                              Dismiss
                            </Button>
                          </>
                        )}
                      </div>
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

  const create = async () => {
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
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
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
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => window.open(created.url, "_blank")}>
              Preview as client
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

      <div className="flex items-center justify-end gap-2 border-t border-border/40 pt-3">
        <Button onClick={create} disabled={busy || !title.trim() || selectedCount === 0}>
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
      const data = await r.json();
      setShares(data.shares ?? []);
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
      if (!r.ok) throw new Error(await r.text());
      toast.success("Share revoked");
      refresh();
    } catch (e: any) {
      toast.error("Couldn't revoke", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async (s: ShareRow) => {
    // We only have slug — token isn't returned after create, so we can only re-show the public URL skeleton.
    // For revisiting an existing share, marketers should preview-as-client from the share creation success screen.
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${baseUrl}/share/${s.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(s.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
    toast.info("Slug copied — add the original ?t=… token to open as client");
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
          <StarAgent mood="waving" size={64} hue={217} />
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
                {s.status !== "active" && (
                  <span className="text-[10px] uppercase tracking-wide text-red-600">Revoked</span>
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
              <Button size="sm" variant="ghost" onClick={() => copyLink(s)} title="Copy share URL">
                {copiedId === s.id ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
              {s.status === "active" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => revoke(s.id)}
                  disabled={busy === s.id}
                  title="Revoke share"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
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
    <button
      onClick={() => onChange(!value)}
      className={cn(
        "flex items-center justify-between rounded-lg border px-3 py-2 text-[12px] transition",
        value
          ? "border-foreground/20 bg-card"
          : "border-border/60 bg-background text-muted-foreground",
      )}
    >
      <span>{label}</span>
      <Switch checked={value} onCheckedChange={onChange} />
    </button>
  );
}
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border/60 bg-background px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wide">
      {children}
    </span>
  );
}
