"use client";

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@/lib/navigation";
import { MessageSquare, MoreHorizontal, Pin, Plus, Search } from "@/components/ui/gemini-icons";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Conversation = {
  id: string;
  title: string;
  preview: string | null;
  updated_at: string;
  is_pinned: boolean;
};

function relativeTime(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function RecentChats({
  workspaceId,
  activeConversationId,
  onNavigate,
}: {
  workspaceId: string | null;
  activeConversationId?: string | null;
  onNavigate?: () => void;
}) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let request = supabase
      .from("conversations")
      .select("id,title,preview,updated_at,is_pinned")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .order("is_pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(50);
    if (query.trim()) {
      request = request.or(`title.ilike.%${query.trim()}%,preview.ilike.%${query.trim()}%`);
    }
    const { data, error } = await request;
    if (error) {
      toast.error("Couldn't load conversations", { description: error.message });
    }
    setItems((data as Conversation[] | null) ?? []);
    setLoading(false);
  }, [workspaceId, query]);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    window.addEventListener("chat:conversation-changed", onChanged);
    return () => window.removeEventListener("chat:conversation-changed", onChanged);
  }, [load]);

  const newChat = async () => {
    if (!workspaceId || creating) return;
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("conversations")
        .insert({ workspace_id: workspaceId, title: "New chat" })
        .select("id")
        .single();
      if (error || !data) {
        toast.error("Couldn't start a new chat", { description: error?.message });
        return;
      }
      onNavigate?.();
      navigate({ to: `/app/chat/${data.id}` });
    } finally {
      setCreating(false);
    }
  };

  const open = (id: string) => {
    onNavigate?.();
    navigate({ to: `/app/chat/${id}` });
  };

  const update = async (id: string, patch: { title?: string; is_pinned?: boolean }) => {
    if (!workspaceId) return;
    const { error } = await supabase
      .from("conversations")
      .update(patch)
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error) {
      toast.error("Couldn't update conversation", { description: error.message });
      return;
    }
    await load();
    window.dispatchEvent(new CustomEvent("chat:conversation-changed"));
  };

  const manage = async (conversation: Conversation) => {
    const action = window.prompt(
      "Conversation action: type rename, pin, unpin, or delete",
      conversation.is_pinned ? "unpin" : "rename",
    );
    if (action === "rename") {
      const title = window.prompt("Rename conversation", conversation.title)?.trim();
      if (title) await update(conversation.id, { title: title.slice(0, 120) });
    } else if (action === "pin" || action === "unpin") {
      await update(conversation.id, { is_pinned: action === "pin" });
    } else if (
      action === "delete" &&
      window.confirm("Remove this conversation and its messages?")
    ) {
      if (!workspaceId) return;
      const { error } = await supabase
        .from("conversations")
        .delete()
        .eq("id", conversation.id)
        .eq("workspace_id", workspaceId);
      if (error) {
        toast.error("Couldn't delete conversation", { description: error.message });
        return;
      }
      if (activeConversationId === conversation.id) navigate({ to: "/app" });
      await load();
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void newChat()}
        disabled={creating}
        className="flex h-9 w-full items-center gap-2 rounded-lg bg-primary px-3 text-left text-[12.5px] font-semibold text-primary-foreground transition hover:-translate-y-px hover:shadow-sm disabled:pointer-events-none disabled:opacity-60"
      >
        <Plus className={cn("h-4 w-4", creating && "animate-pulse")} aria-hidden />
        {creating ? "Starting..." : "New Chat"}
      </button>
      <label className="flex h-8 items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 text-muted-foreground focus-within:border-primary/50">
        <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
          className="min-w-0 flex-1 bg-transparent text-[11.5px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      {loading ? (
        <div className="space-y-1 px-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-surface/60" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-[11px] leading-relaxed text-muted-foreground">
          No conversations yet. Start a new chat to begin.
        </div>
      ) : (
        <div className="max-h-[min(46vh,28rem)] space-y-0.5 overflow-y-auto pr-0.5 scrollbar-thin">
          {items.map((conversation) => (
            <div key={conversation.id} className="group relative flex items-center">
              <button
                type="button"
                onClick={() => open(conversation.id)}
                className={cn(
                  "min-w-0 flex-1 rounded-lg px-2.5 py-2 pr-8 text-left transition",
                  activeConversationId === conversation.id
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-surface hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-2">
                  {conversation.is_pinned ? (
                    <Pin className="h-3 w-3 shrink-0 text-primary" aria-label="Pinned" />
                  ) : (
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                    {conversation.title}
                  </span>
                </span>
                <span className="mt-0.5 block truncate pl-5 text-[10.5px] text-muted-foreground/80">
                  {conversation.preview || "Empty conversation"} ·{" "}
                  {relativeTime(conversation.updated_at)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void manage(conversation)}
                aria-label={`Manage ${conversation.title}`}
                title="Conversation actions"
                className="absolute right-1.5 top-2.5 grid h-6 w-6 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
