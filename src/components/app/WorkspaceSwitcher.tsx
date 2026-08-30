import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Plus, Search, LayoutGrid } from "@/components/ui/gemini-icons";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { WorkspaceLogo } from "./WorkspaceLogo";

type Workspace = {
  id: string;
  name: string;
  website_url: string | null;
  industry: string | null;
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

export function WorkspaceSwitcher({
  workspaceId,
  workspaceName,
  workspaceWebsite,
  onSwitch,
}: {
  workspaceId: string | null;
  workspaceName: string;
  workspaceWebsite?: string | null;
  onSwitch?: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
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
    if (!needle) return workspaces;
    return workspaces.filter((w) => displayName(w).toLowerCase().includes(needle));
  }, [q, workspaces]);

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
    onSwitch?.();
    // Hard reload to reinitialize all workspace-scoped state (chat, studio, brand DNA).
    if (typeof window !== "undefined") {
      window.location.assign("/app");
    } else {
      navigate({ to: "/app" });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Switch workspace"
          aria-expanded={open}
          className="group flex w-full items-center gap-2.5 rounded-xl border border-border/60 bg-card/60 px-2.5 py-2 text-left transition hover:border-border hover:bg-card"
        >
          <WorkspaceLogo
            name={workspaceName}
            websiteUrl={workspaceWebsite}
            size={32}
            rounded="lg"
          />

          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-foreground">
              {workspaceName}
            </span>
            <span className="block truncate text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground/80">
              Workspace
            </span>
          </span>
          <ChevronsUpDown
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition group-hover:text-foreground"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[288px] p-0 rounded-xl border border-border/70 bg-popover/95 shadow-xl backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 border-b border-border/60 px-2.5 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search workspaces…"
            className="flex-1 bg-transparent text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        <div className="max-h-[280px] overflow-y-auto p-1.5">
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
              onSwitch?.();
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
              onSwitch?.();
              navigate({ to: "/projects" });
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary/80 text-muted-foreground">
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="flex-1 truncate">Manage all workspaces</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
