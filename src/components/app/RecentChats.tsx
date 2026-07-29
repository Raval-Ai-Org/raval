import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { MessageSquare, ChevronRight } from "@/components/ui/gemini-icons";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Recent = { id: string; name: string; preview?: string | null; at: string };

export function RecentChats({ onNavigate }: { onNavigate?: () => void }) {
  const [items, setItems] = useState<Recent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setSelectedId(
          typeof window !== "undefined" ? localStorage.getItem("workspace:selected") : null,
        );
        const { data: ws } = await supabase
          .from("workspaces")
          .select("id, name, created_at")
          .order("created_at", { ascending: false })
          .limit(8);
        if (!ws || cancelled) { setItems([]); setLoading(false); return; }

        // Grab last user message per workspace for a preview.
        const ids = ws.map((w) => w.id);
        const { data: msgs } = await supabase
          .from("chat_messages")
          .select("workspace_id, content, created_at, role")
          .in("workspace_id", ids)
          .eq("role", "user")
          .order("created_at", { ascending: false })
          .limit(60);

        const previewByWs = new Map<string, { content: string; at: string }>();
        for (const m of msgs ?? []) {
          if (!previewByWs.has(m.workspace_id)) {
            previewByWs.set(m.workspace_id, { content: m.content ?? "", at: m.created_at });
          }
        }

        const merged: Recent[] = ws.map((w) => {
          const p = previewByWs.get(w.id);
          return {
            id: w.id,
            name: w.name || "Untitled workspace",
            preview: p?.content ?? null,
            at: p?.at ?? w.created_at,
          };
        });
        // Sort by most recent activity (message time or workspace update)
        merged.sort((a, b) => (a.at < b.at ? 1 : -1));
        if (!cancelled) { setItems(merged); setLoading(false); }
      } catch {
        if (!cancelled) { setItems([]); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const pick = (id: string) => {
    try { localStorage.setItem("workspace:selected", id); } catch {}
    window.dispatchEvent(new CustomEvent("workspace:changed", { detail: { id } }));
    setSelectedId(id);
    onNavigate?.();
    navigate({ to: "/app" });
  };

  if (loading) {
    return (
      <div className="space-y-1 px-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded-lg bg-surface/60" />
        ))}
      </div>
    );
  }

  if (items.length === 0) return null;

  const top = items.slice(0, 4);

  return (
    <div className="space-y-0.5">
      {top.map((r) => {
        const active = r.id === selectedId;
        const label = r.preview?.trim() || r.name;
        return (
          <button
            key={r.id}
            onClick={() => pick(r.id)}
            title={label}
            className={cn(
              "group flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[12.5px] transition",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-surface hover:text-foreground",
            )}
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{label}</span>
          </button>
        );
      })}
      {items.length > 4 && (
        <Link
          to="/projects"
          onClick={onNavigate}
          className="mt-1 flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground/80 transition hover:bg-surface hover:text-foreground"
        >
          <span>Show more</span>
          <ChevronRight className="h-3 w-3" aria-hidden />
        </Link>
      )}
    </div>
  );
}
