"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  Lightbulb,
  Loader2,
  Lock,
  ExternalLink,
  Sparkles,
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
        setError("This share link has expired or was revoked.");
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
      if (data.locked) {
        setLocked(true);
        return;
      }
      setLocked(false);
      setPwError(null);
      // viewed event
      fetch(`/api/public/share/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: t, kind: "viewed", password: pw }),
      }).catch(() => {});
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
        setIdentityLocked(!!(p.name && p.email));
      }
      const savedPw = sessionStorage.getItem(`share:pw:${slug}`) ?? "";
      if (savedPw) setPassword(savedPw);
      load(t, savedPw || undefined);
    } catch {
      load(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

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

  const sendEvent = async (kind: string, payload: { itemId?: string; body?: string } = {}) => {
    if (!share) return;
    if (!identityLocked) {
      toast.error("Add your name first");
      return;
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
      toast.error("Couldn't send — try again");
      return;
    }
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
  };

  if (loading) return <FullPage title="Loading…" body="Fetching what's been shared with you." />;
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
        <div className="space-y-4">
          <AnimatePresence>
            {items.map((it, idx) => (
              <ItemCard
                key={it.id}
                item={it}
                index={idx}
                allowApprovals={!!share.allowApprovals}
                allowComments={!!share.allowComments}
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
          Powered by Raval AI · This is a read-only review link. All decisions need marketer
          confirmation.
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
  onAction,
  disabled,
}: {
  item: Item;
  index: number;
  allowApprovals: boolean;
  allowComments: boolean;
  onAction: (kind: string, p?: { itemId?: string; body?: string }) => void;
  disabled: boolean;
}) {
  const [drawer, setDrawer] = useState<null | "comment" | "changes" | "reject" | "suggest">(null);
  const [text, setText] = useState("");
  const [done, setDone] = useState<string | null>(null);

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

  const submit = (kind: string) => {
    onAction(kind, { itemId: item.id, body: text || undefined });
    setDone(kind);
    setText("");
    setDrawer(null);
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
          <Check className="h-3.5 w-3.5" /> Sent — your marketer will see this in their inbox.
        </div>
      )}
    </motion.article>
  );
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
        variant === "success" &&
          "hover:border-emerald-500/50 hover:text-emerald-700 dark:hover:text-emerald-400",
        variant === "danger" &&
          "hover:border-red-500/50 hover:text-red-700 dark:hover:text-red-400",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export default SharePage;
