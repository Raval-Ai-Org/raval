"use client";

import { PageLoader } from "@/components/ui/page-loader";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Lightbulb,
  Lock,
  Sparkles,
  Download,
} from "@/components/ui/gemini-icons";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  kind: string;
  title: string | null;
  description: string | null;
  snapshot: any;
};

type ShareInfo = {
  id: string;
  title: string;
  clientName?: string | null;
  clientEmail?: string | null;
  allowComments?: boolean;
  allowApprovals?: boolean;
  allowDownload?: boolean;
  branding?: Record<string, any>;
  workspaceName?: string;
  expiresAt?: string | null;
  passwordRequired?: boolean;
};

type PortalEvent = {
  id: string;
  item_id: string | null;
  kind: string;
  body: string | null;
  actor_name: string | null;
  actor_type: "client" | "team";
  marketer_decision?: string;
  created_at: string;
};

const EVENT_LABEL: Record<string, string> = {
  approved: "Approved",
  rejected: "Rejected",
  requested_changes: "Asked for changes",
  suggested: "Suggestion",
  commented: "Comment",
  replied: "Reply",
};

/** The latest approval-type decision the client made on each item. */
function decisionsByItem(events: PortalEvent[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of events) {
    if (!e.item_id || e.actor_type !== "client") continue;
    if (e.kind === "approved" || e.kind === "rejected" || e.kind === "requested_changes") {
      out[e.item_id] = e.kind;
    }
  }
  return out;
}

export function FullPage({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-dvh bg-background grid place-items-center px-4">
      <div className="max-w-md text-center space-y-3">
        <Logo height={48} />
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function SharePage() {
  const { slug } = useParams<{ slug: string }>();
  const [token, setToken] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [pwInput, setPwInput] = useState<string>("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [events, setEvents] = useState<PortalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<{ name: string; email: string }>({
    name: "",
    email: "",
  });
  const [identityLocked, setIdentityLocked] = useState(false);

  const load = async (t: string, pw?: string) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ t });
      const res = await fetch(`/api/public/share/${slug}?${qs.toString()}`, {
        headers: pw ? { "X-Share-Password": pw } : undefined,
      });
      if (res.status === 410) {
        const reason = await res.text().catch(() => "");
        setError(
          reason === "Expired"
            ? "This link has expired. Ask the sender for a new one."
            : "This link was turned off. Ask the sender for a new one.",
        );
        return;
      }
      if (res.status === 429) {
        setShare((s) => s ?? { id: "", title: "Protected review", passwordRequired: true });
        setLocked(true);
        setPwError("Too many tries. Wait a few minutes and try again.");
        return;
      }
      if (res.status === 404) {
        setError("This share link doesn't exist.");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        if (data?.passwordRequired) {
          setShare(data.share ?? { id: "", title: "Protected review", passwordRequired: true });
          setLocked(true);
          setPwError(pw ? "Incorrect password" : null);
          return;
        }
        setError("Invalid or missing access token.");
        return;
      }
      if (!res.ok) {
        setError("Unable to load share.");
        return;
      }
      setShare(data.share);
      setItems(data.items ?? []);
      setEvents(data.events ?? []);
      if (data.locked) {
        setLocked(true);
        return;
      }
      setLocked(false);
      setPwError(null);
      // One "viewed" note per browser session, not one per reload.
      let seen = false;
      try {
        seen = sessionStorage.getItem(`share:viewed:${slug}`) === "1";
        sessionStorage.setItem(`share:viewed:${slug}`, "1");
      } catch {}
      if (!seen) {
        fetch(`/api/public/share/${slug}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: t, kind: "viewed", password: pw }),
        }).catch(() => {});
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const t = url.searchParams.get("t") ?? "";
    setToken(t);

    try {
      const saved = localStorage.getItem(`share:identity:${slug}`);
      if (saved) {
        const p = JSON.parse(saved);
        setIdentity({ name: p.name ?? "", email: p.email ?? "" });
        // Email is optional, so a saved name is enough to skip the question.
        setIdentityLocked(!!(typeof p.name === "string" && p.name.trim()));
      }
      const savedPw = sessionStorage.getItem(`share:pw:${slug}`) ?? "";
      if (savedPw) setPassword(savedPw);
      load(t, savedPw || undefined);
    } catch {
      load(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Pick up replies from the team while the page is open. Quiet: no loader,
  // and ?refresh=1 so it doesn't count as another view.
  const refreshThread = useCallback(async () => {
    if (!token) return;
    try {
      const qs = new URLSearchParams({ t: token, refresh: "1" });
      const res = await fetch(`/api/public/share/${slug}?${qs.toString()}`, {
        headers: password ? { "X-Share-Password": password } : undefined,
      });
      if (res.status === 410) {
        setError("This link is no longer active.");
        return;
      }
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (data && !data.locked && Array.isArray(data.events)) setEvents(data.events);
    } catch {}
  }, [password, slug, token]);

  const pollRef = useRef(refreshThread);
  useEffect(() => {
    pollRef.current = refreshThread;
  }, [refreshThread]);
  const unlocked = !!share && !locked && !loading && !error;
  useEffect(() => {
    if (!unlocked) return;
    const id = window.setInterval(() => {
      if (!document.hidden) void pollRef.current();
    }, 30_000);
    const onVisible = () => {
      if (!document.hidden) void pollRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [unlocked]);

  const itemDecisions = useMemo(() => decisionsByItem(events), [events]);
  const itemTitles = useMemo(
    () => Object.fromEntries(items.map((i) => [i.id, i.title ?? "Item"])),
    [items],
  );

  const submitPassword = async () => {
    const pw = pwInput.trim();
    if (!pw) {
      setPwError("Enter the password");
      return;
    }
    setPassword(pw);
    try {
      sessionStorage.setItem(`share:pw:${slug}`, pw);
    } catch {}
    await load(token, pw);
  };

  const saveIdentity = () => {
    if (!identity.name.trim()) {
      toast.error("Please enter your name");
      return;
    }
    try {
      localStorage.setItem(`share:identity:${slug}`, JSON.stringify(identity));
    } catch {}
    setIdentityLocked(true);
    toast.success("Welcome " + identity.name.split(" ")[0]);
  };

  const sendEvent = async (
    kind: string,
    payload: { itemId?: string; body?: string } = {},
  ): Promise<boolean> => {
    if (!share) return false;
    if (!identityLocked) {
      toast.error("Add your name first");
      return false;
    }
    const res = await fetch(`/api/public/share/${slug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        kind,
        itemId: payload.itemId,
        body: payload.body,
        password: password || undefined,
        actorName: identity.name || undefined,
        actorEmail: identity.email || undefined,
      }),
    });
    if (!res.ok) {
      toast.error(
        res.status === 410
          ? "This link is no longer active"
          : res.status === 403
            ? "That isn't allowed on this link"
            : "Couldn't send. Try again.",
      );
      return false;
    }
    setEvents((current) => [
      ...current,
      {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        item_id: payload.itemId ?? null,
        kind,
        body: payload.body ?? null,
        actor_name: identity.name || null,
        actor_type: "client",
        created_at: new Date().toISOString(),
      },
    ]);
    toast.success(
      kind === "approved"
        ? "Approved — sent to marketer for confirmation"
        : kind === "rejected"
          ? "Rejection sent"
          : kind === "requested_changes"
            ? "Change request sent"
            : kind === "suggested"
              ? "Suggestion sent to marketer"
              : "Comment sent",
    );
    return true;
  };

  if (loading) return <PageLoader label="Loading…" />;
  if (error) return <FullPage title="Can't open this share" body={error} />;
  if (!share) return <FullPage title="Not found" body="" />;

  if (locked) {
    return (
      <div className="min-h-dvh bg-background grid place-items-center px-4">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <div className="text-[13px] font-semibold">Password required</div>
          </div>
          <p className="text-[12.5px] text-muted-foreground">
            {share.title
              ? `“${share.title}” is password protected.`
              : "This review link is password protected."}
          </p>
          <Input
            type="password"
            autoFocus
            placeholder="Enter password"
            value={pwInput}
            onChange={(e) => {
              setPwInput(e.target.value);
              setPwError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitPassword();
            }}
          />
          {pwError && <div className="text-[12px] text-red-600">{pwError}</div>}
          <Button className="w-full" onClick={submitPassword}>
            Unlock
          </Button>
        </div>
      </div>
    );
  }

  const accent = share.branding?.accent || "hsl(var(--brand-blue))";

  return (
    <div className="min-h-dvh bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <Logo height={32} />
            <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              Client Review
            </span>
          </div>
          <div className="text-right">
            <div className="text-[12.5px] font-semibold">{share.workspaceName}</div>
            {share.expiresAt && (
              <div className="text-[10.5px] text-muted-foreground">
                Expires {new Date(share.expiresAt).toLocaleDateString()}
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-4 py-8 space-y-6">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border/60 bg-card p-6 sm:p-8 shadow-sm"
          style={{ background: `linear-gradient(135deg, ${accent}10, transparent 60%)` }}
        >
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
            <Sparkles className="h-3 w-3" /> For your review
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{share.title}</h1>
          {share.clientName && (
            <p className="mt-2 text-muted-foreground">
              Prepared for <span className="text-foreground">{share.clientName}</span>
            </p>
          )}
        </motion.div>

        {/* Identity gate */}
        {!identityLocked && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-xl border border-dashed border-border/70 bg-card/60 p-5"
          >
            <div className="text-[13px] font-semibold mb-1">Tell us who you are</div>
            <div className="text-[12px] text-muted-foreground mb-3">
              So your marketer can attribute comments and approvals to you.
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <Input
                placeholder="Your name"
                value={identity.name}
                onChange={(e) => setIdentity((p) => ({ ...p, name: e.target.value }))}
              />
              <Input
                placeholder="Email (optional)"
                value={identity.email}
                onChange={(e) => setIdentity((p) => ({ ...p, email: e.target.value }))}
              />
            </div>
            <Button className="mt-3" onClick={saveIdentity}>
              Continue
            </Button>
          </motion.div>
        )}

        {/* Items */}
        {events.length > 0 && (
          <section className="rounded-2xl border border-border/60 bg-card p-5 sm:p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">Conversation</h2>
              <span className="text-[11px] text-muted-foreground">
                {events.length} {events.length === 1 ? "message" : "messages"}
              </span>
            </div>
            <div className="space-y-3">
              {events.map((event) => (
                <div
                  key={event.id}
                  className={cn(
                    "rounded-xl px-3.5 py-3 text-[13px]",
                    event.actor_type === "team"
                      ? "bg-secondary"
                      : "bg-[hsl(var(--brand-blue)/0.08)]",
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-[10.5px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {event.actor_name ?? (event.actor_type === "team" ? "Team" : "Client")}
                    </span>
                    <time dateTime={event.created_at}>
                      {new Date(event.created_at).toLocaleString()}
                    </time>
                  </div>
                  <EventHeading
                    event={event}
                    itemTitle={event.item_id ? itemTitles[event.item_id] : undefined}
                  />
                  {event.body && <p className="whitespace-pre-wrap">{event.body}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="space-y-4">
          <AnimatePresence>
            {items.map((it, idx) => (
              <ItemCard
                key={it.id}
                item={it}
                index={idx}
                allowApprovals={!!share.allowApprovals}
                allowComments={!!share.allowComments}
                allowDownload={!!share.allowDownload}
                decision={itemDecisions[it.id] ?? null}
                onAction={sendEvent}
                disabled={!identityLocked}
              />
            ))}
          </AnimatePresence>
          {items.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/60 py-12 text-center text-muted-foreground">
              Nothing shared yet.
            </div>
          )}
        </div>

        <footer className="pt-8 pb-6 text-center text-[11px] text-muted-foreground">
          Powered by Mellox AI · The team confirms every decision before anything changes.
        </footer>
      </section>
    </div>
  );
}

function ItemCard({
  item,
  index,
  allowApprovals,
  allowComments,
  allowDownload,
  decision,
  onAction,
  disabled,
}: {
  item: Item;
  index: number;
  allowApprovals: boolean;
  allowComments: boolean;
  allowDownload: boolean;
  decision: string | null;
  onAction: (kind: string, p?: { itemId?: string; body?: string }) => Promise<boolean>;
  disabled: boolean;
}) {
  const [drawer, setDrawer] = useState<null | "comment" | "changes" | "reject" | "suggest">(null);
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  // What the client already decided (from the thread) or just sent.
  const done = sent ?? decision;

  const snapshot = item.snapshot || {};
  const body = snapshot.body || snapshot.content || item.description || "";
  const hashtags: string[] = Array.isArray(snapshot.hashtags) ? snapshot.hashtags : [];
  const channel = snapshot.channel;
  const scheduledAt = snapshot.scheduled_at;

  const kindLabel = useMemo(() => {
    switch (item.kind) {
      case "content_item":
        return channel ? `${channel} post` : "Content";
      case "audit":
        return "GEO / AEO audit";
      case "brand_dna":
        return "Brand snapshot";
      case "calendar":
        return "Content calendar";
      default:
        return "Note";
    }
  }, [item.kind, channel]);

  const submit = async (kind: string) => {
    const ok = await onAction(kind, { itemId: item.id, body: text || undefined });
    if (!ok) return;
    setSent(kind);
    setText("");
    setDrawer(null);
  };

  const download = () => {
    const tags = hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ");
    const text = [item.title, body, tags].filter(Boolean).join("\n\n");
    const href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const name = (item.title || "content")
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .slice(0, 60);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${name || "content"}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="rounded-2xl border border-border/60 bg-card overflow-hidden"
    >
      <div className="px-5 sm:px-6 pt-5 pb-3 border-b border-border/40">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
            {kindLabel}
          </span>
          {scheduledAt && (
            <span className="text-[10.5px] text-muted-foreground">
              {new Date(scheduledAt).toLocaleString()}
            </span>
          )}
        </div>
        {item.title && <h2 className="text-[16px] font-semibold tracking-tight">{item.title}</h2>}
      </div>

      <div className="px-5 sm:px-6 py-4 text-[14px] leading-relaxed whitespace-pre-wrap">
        {body || <span className="text-muted-foreground italic">No content body</span>}
      </div>

      {hashtags.length > 0 && (
        <div className="px-5 sm:px-6 pb-3 flex flex-wrap gap-1.5">
          {hashtags.map((h) => (
            <span key={h} className="text-[11px] text-[hsl(var(--brand-blue))]">
              #{h.replace(/^#/, "")}
            </span>
          ))}
        </div>
      )}

      {snapshot.media_url && (
        <img src={snapshot.media_url} alt="" className="w-full max-h-[360px] object-cover" />
      )}

      {/* Action bar */}
      <div className="border-t border-border/40 bg-secondary/30 px-3 sm:px-4 py-2.5 flex flex-wrap items-center gap-1.5">
        {allowApprovals && (
          <>
            <ActionButton
              icon={ThumbsUp}
              label={done === "approved" ? "Approved" : "Approve"}
              variant="success"
              onClick={() => submit("approved")}
              disabled={disabled || done === "approved"}
            />
            <ActionButton
              icon={MessageSquare}
              label="Request changes"
              onClick={() => setDrawer("changes")}
              disabled={disabled}
            />
            <ActionButton
              icon={ThumbsDown}
              label="Reject"
              variant="danger"
              onClick={() => setDrawer("reject")}
              disabled={disabled}
            />
          </>
        )}
        <ActionButton
          icon={Lightbulb}
          label="Suggest"
          onClick={() => setDrawer("suggest")}
          disabled={disabled}
        />
        {allowComments && (
          <ActionButton
            icon={MessageSquare}
            label="Comment"
            onClick={() => setDrawer("comment")}
            disabled={disabled}
          />
        )}
        {allowDownload && <ActionButton icon={Download} label="Download text" onClick={download} />}
        {allowDownload &&
          typeof snapshot.media_url === "string" &&
          /^https?:\/\//.test(snapshot.media_url) && (
            <a
              href={snapshot.media_url}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background px-3 py-1.5 text-[12px] font-medium transition hover:border-foreground/30 hover:bg-card"
            >
              <Download className="h-3.5 w-3.5" />
              Image
            </a>
          )}
      </div>

      <AnimatePresence>
        {drawer && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border/40 bg-background"
          >
            <div className="px-4 sm:px-5 py-3 space-y-2">
              <div className="text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
                {drawer === "changes"
                  ? "What changes would you like?"
                  : drawer === "reject"
                    ? "Why are you rejecting this?"
                    : drawer === "suggest"
                      ? "Your suggestion"
                      : "Add a comment"}
              </div>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder="Be specific — your marketer reads every word."
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDrawer(null);
                    setText("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    submit(
                      drawer === "changes"
                        ? "requested_changes"
                        : drawer === "reject"
                          ? "rejected"
                          : drawer === "suggest"
                            ? "suggested"
                            : "commented",
                    )
                  }
                  disabled={!text.trim()}
                >
                  Send
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {done && (
        <div
          className={cn(
            "px-5 py-2 text-[12px] flex items-center gap-1.5",
            done === "approved"
              ? "text-emerald-600"
              : done === "rejected"
                ? "text-red-600"
                : "text-foreground",
          )}
        >
          <Check className="h-3.5 w-3.5" />
          {sent
            ? "Sent. The team will see this in their inbox."
            : done === "approved"
              ? "You approved this."
              : done === "rejected"
                ? "You rejected this."
                : "You asked for changes."}
        </div>
      )}
    </motion.article>
  );
}

function EventHeading({ event, itemTitle }: { event: PortalEvent; itemTitle?: string }) {
  const plain = event.kind === "commented" || event.kind === "replied";
  const label = plain ? null : (EVENT_LABEL[event.kind] ?? event.kind.replaceAll("_", " "));
  const text = [label, itemTitle].filter(Boolean).join(" · ");
  if (!text) return null;
  return <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">{text}</div>;
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant,
}: {
  icon: any;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "success" | "danger";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-[12px] font-medium transition disabled:opacity-50",
        "border-border/70 hover:border-foreground/30 hover:bg-card",
        variant === "success" && "hover:border-success-border hover:text-success",
        variant === "danger" && "hover:border-danger-border hover:text-danger",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export default SharePage;
