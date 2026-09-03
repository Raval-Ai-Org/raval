"use client";

import { useNavigate, Link } from "@/lib/navigation";
import { useServerFn } from "@/lib/use-server-fn";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { signOutAndRedirect } from "@/lib/auth";
import { createWorkspace, ensureAuthWorkspace } from "@/lib/workspaces.functions";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  Globe,
  ArrowRight,
  Sparkles,
  Loader2,
  LogOut,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  ExternalLink,
  Clock,
  LayoutDashboard,
  UserCircle2,
  Settings,
  HelpCircle,
  UserPlus,
} from "@/components/ui/gemini-icons";
import { toast } from "sonner";
import { pageHead, webPageLd } from "@/lib/seo";
import { cn } from "@/lib/utils";
import { usePersona, type PersonaCopy } from "@/hooks/use-persona";
import { PersonaDialog } from "@/components/app/PersonaDialog";

type Workspace = {
  id: string;
  name: string;
  website_url: string | null;
  industry: string | null;
  onboarded_at: string | null;
  created_at: string;
  client_status: "active" | "onboarding" | "paused";
};

export type ClientStatus = Workspace["client_status"];

const STATUS_META: Record<ClientStatus, { label: string; dot: string; chipText: string }> = {
  active: {
    label: "Active",
    dot: "bg-emerald-500",
    chipText: "text-emerald-600 dark:text-emerald-400",
  },
  onboarding: {
    label: "Onboarding",
    dot: "bg-amber-500",
    chipText: "text-amber-600 dark:text-amber-400",
  },
  paused: { label: "Paused", dot: "bg-zinc-400", chipText: "text-muted-foreground" },
};

const SELECTED_KEY = "workspace:selected";

function ProjectsPage() {
  const navigate = useNavigate();
  const ensureWorkspace = useServerFn(ensureAuthWorkspace);
  const { persona, copy, loading: personaLoading, setPersona } = usePersona();
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [userEmail, setUserEmail] = useState<string>("");
  const [userName, setUserName] = useState<string>("");
  const [userAvatar, setUserAvatar] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [renameTarget, setRenameTarget] = useState<Workspace | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null);

  const refresh = async () => {
    const { data, error } = await supabase
      .from("workspaces")
      .select("id, name, website_url, industry, onboarded_at, created_at, client_status")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Couldn't load clients");
      return;
    }
    setWorkspaces(data ?? []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        navigate({ to: "/login" });
        return;
      }
      const u = sess.session.user;
      setUserEmail(u.email ?? "");
      const meta = (u.user_metadata ?? {}) as Record<string, any>;
      setUserName(meta.full_name || meta.name || (u.email ? u.email.split("@")[0] : ""));
      setUserAvatar(meta.avatar_url || meta.picture || "");
      try {
        await ensureWorkspace();
      } catch (error) {
        toast.error("Couldn't prepare your workspace");
      }
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const openProject = (w: Workspace) => {
    localStorage.setItem(SELECTED_KEY, w.id);
    if (!w.onboarded_at) navigate({ to: "/onboarding" });
    else navigate({ to: "/app" });
  };

  const signOut = async () => {
    await signOutAndRedirect();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workspaces;
    return workspaces.filter((w) =>
      [w.name, w.website_url, w.industry].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [workspaces, query]);

  const handleRename = async (id: string, name: string) => {
    const { error } = await supabase.from("workspaces").update({ name: name.trim() }).eq("id", id);
    if (error) {
      toast.error("Couldn't rename");
      return;
    }
    toast.success("Client renamed");
    setRenameTarget(null);
    refresh();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("workspaces").delete().eq("id", id);
    if (error) {
      toast.error("Couldn't remove client");
      return;
    }
    if (localStorage.getItem(SELECTED_KEY) === id) localStorage.removeItem(SELECTED_KEY);
    toast.success("Client removed");
    setDeleteTarget(null);
    refresh();
  };

  const handleStatus = async (id: string, status: ClientStatus) => {
    const prev = workspaces;
    setWorkspaces((ws) => ws.map((w) => (w.id === id ? { ...w, client_status: status } : w)));
    const { error } = await supabase
      .from("workspaces")
      .update({ client_status: status })
      .eq("id", id);
    if (error) {
      setWorkspaces(prev);
      toast.error("Couldn't update status");
      return;
    }
    toast.success(`Marked ${STATUS_META[status].label.toLowerCase()}`);
  };

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background text-foreground">
      <AuroraBackdrop />

      {/* Top bar */}
      <header className="relative z-10 flex h-14 items-center justify-between gap-3 px-5">
        <Link to="/workspaces" aria-label="Mellox AI home" className="flex h-9 shrink-0 items-center">
          <Logo height={30} />
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          <AgencyHqPill />
          <AccountMenu
            email={userEmail}
            name={userName}
            avatarUrl={userAvatar}
            onSignOut={signOut}
          />
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-5 pt-14 pb-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-[11.5px] font-medium text-muted-foreground backdrop-blur"
        >
          <Sparkles className="h-3 w-3 text-aura" />
          Agency dashboard
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
          className="font-display mt-4 text-[40px] leading-[1.05] tracking-tight sm:text-[52px]"
        >
          {loading
            ? `Loading your ${copy.nounPlural}…`
            : workspaces.length === 0
              ? copy.firstHeadline(userName ? userName.split(" ")[0] : undefined)
              : copy.returningHeadline(userEmail ? userEmail.split("@")[0] : undefined)}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className="mt-2 text-[14px] text-muted-foreground"
        >
          {workspaces.length === 0 ? copy.firstSubhead : copy.returningSubhead}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mt-8 w-full max-w-xl"
        >
          <PasteLinkBar
            onCreated={(id) => {
              localStorage.setItem(SELECTED_KEY, id);
              navigate({ to: "/onboarding" });
            }}
            onOpenAdvanced={() => setDialogOpen(true)}
          />
          <NewProjectDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            copy={copy}
            mandatory={!loading && !personaLoading && !!persona && workspaces.length === 0}
            onCreated={(id) => {
              localStorage.setItem(SELECTED_KEY, id);
              navigate({ to: "/onboarding" });
            }}
          />
        </motion.div>
      </section>

      {/* Projects panel — only shown when at least one client exists */}
      {!loading && workspaces.length > 0 && (
        <section className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-20">
          <div className="rounded-3xl border border-border/70 bg-card/70 p-5 backdrop-blur-xl sm:p-7">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-border/70 bg-background/60 px-3 py-1 text-[12px] font-medium text-foreground">
                  {copy.sectionTitle}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {workspaces.length} {workspaces.length === 1 ? copy.noun : copy.nounPlural}
                </span>
              </div>

              <div className="flex w-full items-center gap-2 sm:w-auto">
                <div className="flex h-9 flex-1 items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 backdrop-blur focus-within:border-foreground/30 sm:flex-none">
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={copy.searchPlaceholder}
                    className="h-full w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground sm:w-56"
                  />
                </div>
                <Button
                  onClick={() => setDialogOpen(true)}
                  className="btn-aura h-9 shrink-0 gap-1.5 rounded-full px-3.5 text-[13px]"
                >
                  <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New</span>
                </Button>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="grid place-items-center rounded-2xl border border-dashed border-border/60 bg-background/40 px-6 py-12 text-center">
                <Search className="h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-[13px] text-muted-foreground">
                  No {copy.nounPlural} match "{query}"
                </p>
                <button
                  onClick={() => setQuery("")}
                  className="mt-3 text-[12px] font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Clear search
                </button>
              </div>
            ) : (
              <motion.div layout className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <AnimatePresence initial={false}>
                  {filtered.map((w, i) => (
                    <ProjectCard
                      key={w.id}
                      workspace={w}
                      index={i}
                      onOpen={() => openProject(w)}
                      onRename={() => setRenameTarget(w)}
                      onDelete={() => setDeleteTarget(w)}
                      onStatusChange={(s) => handleStatus(w.id, s)}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </div>
        </section>
      )}

      {loading && (
        <section className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-20">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-[210px] animate-pulse rounded-2xl border border-border/60 bg-background/40"
              />
            ))}
          </div>
        </section>
      )}

      {/* Rename dialog */}
      <RenameDialog
        workspace={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSave={handleRename}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.deletePromptTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" and all its data — chats, content, settings — will be
              permanently removed. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* One-time persona picker — blocks everything until answered */}
      <PersonaDialog
        open={!loading && !personaLoading && !persona}
        onConfirm={async (p) => {
          await setPersona(p);
        }}
      />
    </div>
  );
}

function AgencyHqPill() {
  return (
    <Link
      to="/agency"
      aria-label="Open Command Center — combined view across all clients"
      className="group relative inline-flex h-9 items-center gap-2 overflow-hidden rounded-full border border-brand-green/35 bg-brand-green/[0.09] pl-1 pr-3.5 text-[13px] font-semibold text-brand-green backdrop-blur-md transition hover:bg-brand-green/[0.14] hover:border-brand-green/55 hover:shadow-[0_0_28px_-6px_hsl(var(--brand-green)/0.38)]"
    >
      <span className="relative grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-brand-green to-emerald-700 text-white shadow-[0_0_14px_-3px_hsl(var(--brand-green)/0.5)] transition group-hover:scale-[1.06]">
        <LayoutDashboard className="h-3.5 w-3.5" strokeWidth={2.2} />
        <span className="pointer-events-none absolute inset-0 rounded-full border border-white/20" />
      </span>
      <span className="tracking-tight">Command Center</span>
      <ArrowRight className="h-3.5 w-3.5 text-brand-green/70 transition group-hover:translate-x-0.5 group-hover:text-brand-green" />
      {/* Shimmer sweep on hover */}
      <span className="pointer-events-none absolute inset-0 -translate-x-full rounded-full bg-gradient-to-r from-transparent via-white/12 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
    </Link>
  );
}

function Avatar({
  name,
  email,
  avatarUrl,
  size = 36,
}: {
  name?: string;
  email?: string;
  avatarUrl?: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const initial = (name || email || "U").trim().charAt(0).toUpperCase();
  const palette = ["#1a73e8", "#d93025", "#188038", "#e8710a", "#9334e6", "#1e8e8e"];
  const color = palette[(name || email || "U").charCodeAt(0) % palette.length];
  if (avatarUrl && !broken) {
    return (
      <img
        src={avatarUrl}
        alt={name || email || "Account"}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
        className="rounded-full object-cover ring-1 ring-border/60"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}
      className="grid place-items-center rounded-full font-semibold text-white ring-1 ring-border/60"
      aria-hidden
    >
      {initial}
    </div>
  );
}

function AccountMenu({
  email,
  name,
  avatarUrl,
  onSignOut,
}: {
  email: string;
  name: string;
  avatarUrl: string;
  onSignOut: () => void;
}) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Account — ${name || email}`}
          className="group relative grid h-9 w-9 place-items-center rounded-full outline-none transition hover:ring-2 hover:ring-brand-green/40 focus-visible:ring-2 focus-visible:ring-brand-green/60"
        >
          <Avatar name={name} email={email} avatarUrl={avatarUrl} size={32} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={10}
        className="w-[300px] rounded-2xl p-0 overflow-hidden"
      >
        <div className="flex flex-col items-center gap-2 px-4 pt-5 pb-4 text-center">
          <Avatar name={name} email={email} avatarUrl={avatarUrl} size={64} />
          <div className="mt-1 text-[14px] font-semibold leading-tight text-foreground">
            Hi, {(name || email.split("@")[0] || "there").split(" ")[0]}!
          </div>
          <div className="text-[12px] text-muted-foreground truncate max-w-full">{email}</div>
          <button
            onClick={() => navigate({ to: "/app" })}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-3.5 py-1.5 text-[12px] font-medium text-foreground transition hover:bg-muted"
          >
            <UserCircle2 className="h-3.5 w-3.5" /> Manage your account
          </button>
        </div>
        <DropdownMenuSeparator className="m-0" />
        <div className="p-1.5">
          <DropdownMenuItem
            className="gap-2.5 rounded-lg py-2 text-[13px]"
            onSelect={() => navigate({ to: "/agency" })}
          >
            <LayoutDashboard className="h-4 w-4 text-muted-foreground" /> Command Center
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2.5 rounded-lg py-2 text-[13px]"
            onSelect={() => navigate({ to: "/onboarding" })}
          >
            <UserPlus className="h-4 w-4 text-muted-foreground" /> Add another client
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2.5 rounded-lg py-2 text-[13px]"
            onSelect={() => navigate({ to: "/app" })}
          >
            <Settings className="h-4 w-4 text-muted-foreground" /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2.5 rounded-lg py-2 text-[13px]"
            onSelect={() => {
              window.location.href = "mailto:support@mellox.ai?subject=Mellox%20AI%20support";
            }}
          >
            <HelpCircle className="h-4 w-4 text-muted-foreground" /> Help & support
          </DropdownMenuItem>
        </div>
        <DropdownMenuSeparator className="m-0" />
        <div className="p-1.5">
          <DropdownMenuItem
            className="gap-2.5 rounded-lg py-2 text-[13px] text-red-600 dark:text-red-400 focus:text-red-600"
            onSelect={onSignOut}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </DropdownMenuItem>
        </div>
        <div className="px-4 py-2.5 text-center text-[10.5px] text-muted-foreground/80 border-t border-border/50">
          Privacy · Terms
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectCard({
  workspace,
  index,
  onOpen,
  onRename,
  onDelete,
  onStatusChange,
}: {
  workspace: Workspace;
  index: number;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  onStatusChange: (s: ClientStatus) => void;
}) {
  const domain = workspace.website_url
    ? workspace.website_url
        .replace(/^https?:\/\//i, "")
        .replace(/\/$/, "")
        .split("/")[0]
    : null;
  const initials = (workspace.name || domain || "W").slice(0, 2).toUpperCase();
  const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null;
  const screenshotUrl = domain
    ? `https://s.wordpress.com/mshots/v1/${encodeURIComponent("https://" + domain)}?w=720&h=405`
    : null;
  const [faviconOk, setFaviconOk] = useState(false);
  const [shotOk, setShotOk] = useState(false);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ delay: 0.04 * index, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-background/60 text-left shadow-sm transition hover:border-brand-green/50 hover:shadow-[0_12px_32px_-12px_hsl(var(--brand-green)/0.28)]"
    >
      {/* Colorful hover aura */}
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-green/[0.08] via-transparent to-brand-blue/[0.06]" />
      </div>

      <button
        onClick={onOpen}
        className="group/thumb relative block w-full overflow-hidden text-left"
      >
        <div className="relative aspect-[16/9] w-full overflow-hidden bg-secondary/60">
          {/* Monochrome canvas — becomes colorful on hover */}
          <div className="absolute inset-0 transition-opacity duration-500 group-hover:opacity-0 bg-[radial-gradient(circle_at_20%_15%,hsl(var(--foreground)/0.06),transparent_60%),radial-gradient(circle_at_85%_90%,hsl(var(--foreground)/0.05),transparent_55%)]" />
          <div className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 bg-[radial-gradient(circle_at_20%_15%,hsl(var(--brand-green)/0.12),transparent_60%),radial-gradient(circle_at_85%_90%,hsl(var(--brand-blue)/0.08),transparent_55%)]" />
          {/* Faint grid */}
          <div
            className="absolute inset-0 opacity-[0.06] transition-opacity duration-500 group-hover:opacity-[0.04]"
            style={{
              backgroundImage:
                "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          />

          {/* Site screenshot (monochrome) */}
          {screenshotUrl && (
            <img
              src={screenshotUrl}
              alt=""
              loading="lazy"
              draggable={false}
              onLoad={(e) => {
                // mshots returns a ~400x300 WordPress placeholder while generating.
                // Real screenshots come back at 720px wide — require that to avoid showing the placeholder.
                const img = e.currentTarget;
                if (img.naturalWidth >= 600) setShotOk(true);
              }}
              onError={() => setShotOk(false)}
              className={cn(
                "absolute inset-0 h-full w-full object-cover object-top transition-all duration-500",
                "grayscale contrast-[1.05] opacity-0 group-hover/thumb:scale-[1.02] group-hover/thumb:grayscale-0 group-hover/thumb:contrast-100",
                shotOk && "opacity-90 group-hover/thumb:opacity-100",
              )}
            />
          )}
          {/* Soft top/bottom vignette for legibility */}
          <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-background/40 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background/70 to-transparent" />

          {/* Brand mark when no screenshot — clean monochrome lockup */}
          {!shotOk && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-xl bg-background/80 ring-1 ring-border/70 shadow-sm">
                {faviconUrl && (
                  <img
                    src={faviconUrl}
                    alt=""
                    onLoad={() => setFaviconOk(true)}
                    onError={() => setFaviconOk(false)}
                    className={cn(
                      "h-7 w-7 object-contain transition-opacity",
                      faviconOk ? "opacity-100" : "opacity-0 absolute",
                    )}
                    draggable={false}
                  />
                )}
                {!faviconOk && (
                  <span className="text-[13px] font-semibold tracking-tight text-foreground/80">
                    {initials}
                  </span>
                )}
              </div>
              <span className="font-display text-[18px] leading-none tracking-tight text-foreground/80">
                {domain || workspace.name}
              </span>
            </div>
          )}

          {/* Client status chip */}
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[10.5px] font-medium text-foreground/80 backdrop-blur">
            <span
              className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[workspace.client_status].dot)}
            />
            {STATUS_META[workspace.client_status].label}
          </span>
        </div>
      </button>

      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary text-[11px] font-semibold text-foreground ring-1 ring-border/60">
            {faviconUrl && (
              <img
                src={faviconUrl}
                alt=""
                onLoad={() => setFaviconOk(true)}
                onError={() => setFaviconOk(false)}
                className={cn(
                  "absolute inset-0 h-full w-full object-contain p-1 transition-opacity",
                  faviconOk ? "opacity-100" : "opacity-0",
                )}
                draggable={false}
              />
            )}
            {!faviconOk && <span>{initials}</span>}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold tracking-tight">
              {workspace.name || domain || "Untitled"}
            </div>
            <div className="flex items-center gap-1.5 truncate text-[11.5px] text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              <span className="truncate">
                {domain ||
                  workspace.industry ||
                  (workspace.onboarded_at ? "Ready to chat" : "Finish setup")}
                {" · "}
                {formatRelative(workspace.created_at)}
              </span>
            </div>
          </div>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-0 transition hover:bg-secondary hover:text-foreground group-hover:opacity-100 focus:opacity-100"
              aria-label="Project options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onOpen}>
              <ArrowRight className="mr-2 h-3.5 w-3.5" /> Open project
            </DropdownMenuItem>
            {workspace.website_url && (
              <DropdownMenuItem asChild>
                <a href={workspace.website_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-3.5 w-3.5" /> Visit website
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Client status
            </div>
            {(Object.keys(STATUS_META) as ClientStatus[]).map((s) => (
              <DropdownMenuItem key={s} onClick={() => onStatusChange(s)} className="text-[12.5px]">
                <span className={cn("mr-2 h-2 w-2 rounded-full", STATUS_META[s].dot)} />
                {STATUS_META[s].label}
                {workspace.client_status === s && (
                  <span className="ml-auto text-[10px] text-muted-foreground">current</span>
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border/70 bg-background/40 px-6 py-14 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-aura via-aura-purple to-aura-pink text-white">
        <Sparkles className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-[15px] font-semibold tracking-tight">No projects yet</h3>
      <p className="mt-1 max-w-sm text-[12.5px] text-muted-foreground">
        Add your first website and Mellox AI will set up a workspace for it in seconds.
      </p>
      <Button onClick={onAdd} className="btn-aura mt-5 h-9 gap-1.5 rounded-full px-4">
        <Plus className="h-3.5 w-3.5" /> Add a project
      </Button>
    </div>
  );
}

function PasteLinkBar({
  onCreated,
  onOpenAdvanced,
}: {
  onCreated: (id: string) => void;
  onOpenAdvanced: () => void;
}) {
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const createWorkspaceFn = useServerFn(createWorkspace);

  const isValid = useMemo(() => {
    const v = url.trim();
    if (!v) return false;
    return /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/.*)?$/i.test(v);
  }, [url]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || saving) return;
    const cleanUrl = url.trim();
    const normalizedUrl = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
    let host = "";
    try {
      host = new URL(normalizedUrl).hostname.replace(/^www\./i, "");
    } catch {
      host = cleanUrl;
    }
    const derivedName = host.split(".")[0]
      ? host
          .split(".")[0]
          .replace(/[-_]+/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : "New project";

    setSaving(true);
    try {
      const data = await createWorkspaceFn({
        data: { name: derivedName, websiteUrl: normalizedUrl },
      });
      toast.success("Project created — let's set it up");
      onCreated(data as string);
    } catch (error: any) {
      toast.error(error?.message ?? "Couldn't create project");
    } finally {
      setSaving(false);
      return;
    }
  };

  const onPasteShortcut = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      toast.message("Paste your link into the field");
    }
  };

  return (
    <div className="relative">
      {/* Ambient glow behind the pill */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-10 -inset-y-8 -z-10 rounded-[100%] opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 50%, hsl(var(--aura) / 0.18), transparent 70%)",
        }}
      />

      <form
        data-no-rhythm
        onSubmit={submit}
        className={cn(
          "group relative flex h-14 items-center gap-1.5 rounded-full border border-border/70 bg-[hsl(0_0%_8%/0.85)] pl-1.5 pr-1.5 backdrop-blur-xl",
          "shadow-[0_1px_0_hsl(0_0%_100%/0.04)_inset,0_20px_60px_-30px_hsl(0_0%_0%/0.9)]",
          "transition focus-within:border-foreground/30",
        )}
      >
        <button
          type="button"
          onClick={onPasteShortcut}
          aria-label="Paste from clipboard"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
        >
          <Plus className="h-5 w-5" strokeWidth={2} />
        </button>

        <input
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste your website link"
          className="!mt-0 h-11 min-w-0 flex-1 bg-transparent px-1 text-[15px] tracking-tight text-foreground outline-none placeholder:text-muted-foreground/70"
        />

        <button
          type="submit"
          disabled={!isValid || saving}
          aria-label="Continue"
          className={cn(
            "!mt-0 grid h-11 w-11 shrink-0 place-items-center rounded-full transition",
            isValid && !saving
              ? "bg-gradient-to-br from-aura via-aura-purple to-aura-pink text-white shadow-[0_8px_24px_-10px_hsl(var(--aura)/0.7)] hover:-translate-y-0.5"
              : "bg-white/5 text-muted-foreground",
          )}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className={cn("h-[18px] w-[18px]", !isValid && "opacity-60")} />
          )}
        </button>
      </form>
    </div>
  );
}

function NewProjectDialog({
  children,
  open,
  onOpenChange,
  onCreated,
  mandatory = false,
  copy,
}: {
  children?: React.ReactNode;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
  mandatory?: boolean;
  copy: PersonaCopy;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const createWorkspaceFn = useServerFn(createWorkspace);

  const reset = () => {
    setName("");
    setUrl("");
  };

  // Force the dialog open when it's the user's first workspace — no dismissing.
  const effectiveOpen = mandatory ? true : open;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    const cleanUrl = url.trim();
    if (!trimmed) {
      toast.error(`Give your ${copy.noun} a name`);
      return;
    }
    setSaving(true);
    const normalizedUrl = cleanUrl
      ? /^https?:\/\//i.test(cleanUrl)
        ? cleanUrl
        : `https://${cleanUrl}`
      : undefined;
    try {
      const data = await createWorkspaceFn({
        data: { name: trimmed, websiteUrl: normalizedUrl ?? null },
      });
      toast.success(`${copy.Noun} created`);
      onOpenChange(false);
      reset();
      onCreated(data as string);
    } catch (error: any) {
      toast.error(error?.message ?? `Couldn't create ${copy.noun}`);
    } finally {
      setSaving(false);
      return;
    }
  };

  return (
    <Dialog
      open={effectiveOpen}
      onOpenChange={(v) => {
        if (mandatory && !v) return;
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      {children ? <DialogTrigger asChild>{children}</DialogTrigger> : null}
      <DialogContent
        className="sm:max-w-md"
        onEscapeKeyDown={(e) => {
          if (mandatory) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (mandatory) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (mandatory) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="tracking-tight">
            {mandatory ? copy.mandatoryTitle : copy.normalTitle}
          </DialogTitle>
          <DialogDescription>
            {mandatory ? copy.mandatoryDescription : copy.normalDescription}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="np-name">{copy.nameLabel}</Label>
            <Input
              id="np-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={copy.namePlaceholder}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-url">
              Website URL <span className="text-muted-foreground">(optional)</span>
            </Label>
            <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              <input
                id="np-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://yourcompany.com"
                className="h-9 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <DialogFooter className="pt-2">
            {!mandatory && (
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={saving} className="btn-aura gap-1.5">
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {mandatory ? copy.createFirstCta : copy.createCta}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({
  workspace,
  onClose,
  onSave,
}: {
  workspace: Workspace | null;
  onClose: () => void;
  onSave: (id: string, name: string) => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (workspace) setName(workspace.name ?? "");
  }, [workspace]);

  return (
    <Dialog open={!!workspace} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
          <DialogDescription>Give this workspace a clearer name.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!workspace || !name.trim()) return;
            onSave(workspace.id, name);
          }}
          className="space-y-3 pt-1"
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <DialogFooter className="pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()} className="btn-aura">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AuroraBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
      <div
        className="absolute -top-32 left-1/2 h-[520px] w-[1100px] -translate-x-1/2 rounded-[50%] opacity-80 blur-3xl"
        style={{
          background: "radial-gradient(closest-side, hsl(var(--aura)/0.55), transparent 70%)",
        }}
      />
      <div
        className="absolute top-40 left-[8%] h-[420px] w-[520px] rounded-full opacity-70 blur-3xl"
        style={{
          background: "radial-gradient(closest-side, hsl(var(--aura-pink)/0.55), transparent 70%)",
        }}
      />
      <div
        className="absolute top-24 right-[6%] h-[460px] w-[560px] rounded-full opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, hsl(var(--aura-purple)/0.55), transparent 70%)",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,hsl(var(--background)),transparent_60%)]" />
    </div>
  );
}

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

function formatRelative(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  const w = Math.floor(days / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default ProjectsPage;
