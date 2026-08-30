import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ArrowLeft,
  Check,
  Gift,
  Plus,
  Search,
  Sparkles,
  LayoutGrid,
  LogOut,
} from "@/components/brand/icons";
import { useTokenUsage } from "@/hooks/use-agent-toggles";
import { supabase } from "@/integrations/supabase/client";
import { signOutAndRedirect } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { WorkspaceLogo } from "./WorkspaceLogo";
import { cn } from "@/lib/utils";

type Workspace = {
  id: string;
  name: string;
  website_url: string | null;
  industry: string | null;
};

type Props = {
  workspaceName: string;
  workspaceId: string | null;
  trigger: ReactNode;
};

function displayName(w: Workspace) {
  const domain = w.website_url
    ? w.website_url
        .replace(/^https?:\/\//i, "")
        .replace(/\/$/, "")
        .split("/")[0]
    : null;
  return domain || w.name || w.industry || "Workspace";
}

function initials(name: string) {
  const parts = name
    .trim()
    .split(/\s+|\.|-/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "W") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function WorkspaceMenu({ workspaceName, workspaceId, trigger }: Props) {
  const navigate = useNavigate();
  const { remaining, total, pct } = useTokenUsage();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [signingOut, setSigningOut] = useState(false);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from("workspaces")
        .select("id, name, website_url, industry")
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      setWorkspaces((data ?? []) as Workspace[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? workspaces.filter((w) => displayName(w).toLowerCase().includes(needle))
      : workspaces;
    // Current workspace first
    return [...list].sort((a, b) => {
      if (a.id === workspaceId) return -1;
      if (b.id === workspaceId) return 1;
      return 0;
    });
  }, [q, workspaces, workspaceId]);

  const pick = (w: Workspace) => {
    if (w.id === workspaceId) {
      setOpen(false);
      return;
    }
    const name = displayName(w);
    try {
      localStorage.setItem("workspace:selected", w.id);
      localStorage.setItem("workspace:name", name);
    } catch {}
    window.dispatchEvent(new CustomEvent("workspace:changed", { detail: { id: w.id } }));
    setOpen(false);
    if (typeof window !== "undefined") window.location.assign("/app");
    else navigate({ to: "/app" });
  };

  const remainingDisplay =
    remaining >= 1000
      ? `${(remaining / 1000).toFixed(remaining >= 10_000 ? 0 : 1)}k`
      : `${remaining}`;
  const remainingPct = Math.max(2, 100 - pct);
  const low = remainingPct < 20;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={10}
        className="w-[300px] overflow-hidden rounded-2xl border border-border/60 bg-popover/95 p-0 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
      >
        {/* Back to workspaces dashboard */}
        <button
          onClick={() => {
            setOpen(false);
            navigate({ to: "/projects" });
          }}
          className="group flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          aria-label="Back to workspaces dashboard"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to workspaces</span>
        </button>

        {/* Credits card */}
        <div className="relative overflow-hidden p-3">
          <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-[hsl(var(--brand-green))]/18 blur-2xl" />
          <div className="pointer-events-none absolute -left-8 -bottom-8 h-20 w-20 rounded-full bg-[hsl(var(--brand-blue))]/18 blur-2xl" />

          <div className="relative flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Sparkles className="h-3 w-3 text-[hsl(var(--brand-green))]" />
              Credits
            </div>
            <span className="text-[12px] font-semibold tabular-nums text-foreground">
              {remainingDisplay}
              <span className="ml-1 font-normal text-muted-foreground">left</span>
            </span>
          </div>

          <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-secondary/80">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${remainingPct}%` }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className={cn(
                "h-full rounded-full",
                low
                  ? "bg-gradient-to-r from-amber-500 to-rose-500"
                  : "bg-gradient-to-r from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))]",
              )}
            />
          </div>

          <div className="relative mt-1.5 flex items-center justify-between text-[10.5px] tabular-nums text-muted-foreground">
            <span className={cn(low && "font-medium text-amber-500")}>
              {Math.round(remainingPct)}% remaining
            </span>
            <span>{total >= 1000 ? `${(total / 1000).toFixed(0)}k` : total} / mo</span>
          </div>

          <button
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new CustomEvent("open:publish"));
            }}
            className="relative mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-[hsl(var(--brand-blue))] to-[hsl(var(--brand-green))] px-2 py-1.5 text-[11.5px] font-semibold text-background shadow-[inset_0_1px_0_hsl(0_0%_100%/0.3),0_3px_10px_-3px_hsl(var(--brand-green)/0.5)] transition-transform active:scale-[0.98]"
          >
            <Gift className="h-3.5 w-3.5" strokeWidth={2.2} />
            Get more credits
          </button>
        </div>

        <div className="h-px bg-border/60" />

        {/* Workspaces */}
        <div className="flex items-center justify-between px-3 pb-1 pt-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/80">
            Workspaces
          </div>
        </div>

        <div className="mx-2 mb-2 flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search workspaces…"
            className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        <div className="max-h-[260px] overflow-y-auto px-1.5 pb-1.5 [scrollbar-width:thin]">
          {loading && (
            <div className="space-y-1 px-1 py-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-9 animate-pulse rounded-lg bg-surface/60" />
              ))}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              No workspaces found
            </div>
          )}

          {!loading &&
            filtered.map((w) => {
              const active = w.id === workspaceId;
              const name = displayName(w);
              return (
                <button
                  key={w.id}
                  onClick={() => pick(w)}
                  className={cn(
                    "group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                    active
                      ? "bg-secondary text-foreground"
                      : "text-foreground/85 hover:bg-secondary/70",
                  )}
                >
                  <WorkspaceLogo name={name} websiteUrl={w.website_url} size={28} />

                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{name}</span>
                  {active && (
                    <Check className="h-3.5 w-3.5 text-[hsl(var(--brand-green))]" aria-hidden />
                  )}
                </button>
              );
            })}
        </div>

        <div className="border-t border-border/60 p-1.5">
          <button
            onClick={() => {
              setOpen(false);
              navigate({ to: "/projects" });
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-foreground/85 transition-colors hover:bg-secondary/70 hover:text-foreground"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary/80 text-muted-foreground">
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="flex-1 truncate">New workspace</span>
          </button>
          <button
            onClick={() => {
              setOpen(false);
              navigate({ to: "/projects" });
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary/80 text-muted-foreground">
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="flex-1 truncate">Manage all workspaces</span>
          </button>
          <button
            onClick={async () => {
              if (signingOut) return;
              setSigningOut(true);
              setOpen(false);
              await signOutAndRedirect(queryClient);
            }}
            disabled={signingOut}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground disabled:opacity-60"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary/80 text-muted-foreground">
              <LogOut className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="flex-1 truncate">{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
