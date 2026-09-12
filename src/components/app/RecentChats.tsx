"use client";

import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@/lib/navigation";
import {
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash,
} from "@/components/icons";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

type Conversation = {
  id: string;
  title: string;
  preview: string | null;
  updated_at: string;
  is_pinned: boolean;
};

const TITLE_MAX = 120;

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
  // Rename happens in place in the list rather than in a dialog — it is a
  // one-field edit, and a modal for it would be heavier than the task.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
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
    addAppEventListener("chat:conversation-changed", onChanged);
    return () => removeAppEventListener("chat:conversation-changed", onChanged);
  }, [load]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.select();
  }, [renamingId]);

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
    emitAppEvent("chat:conversation-changed");
  };

  const startRename = (conversation: Conversation) => {
    setRenamingId(conversation.id);
    setDraftTitle(conversation.title);
  };

  const commitRename = async () => {
    const id = renamingId;
    const title = draftTitle.trim().slice(0, TITLE_MAX);
    setRenamingId(null);
    if (!id || !title) return;
    const previous = items.find((item) => item.id === id)?.title;
    if (title === previous) return;
    await update(id, { title });
  };

  const confirmDelete = async () => {
    const conversation = pendingDelete;
    if (!conversation || !workspaceId) return;
    setDeleting(true);
    const { error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", conversation.id)
      .eq("workspace_id", workspaceId);
    setDeleting(false);
    setPendingDelete(null);
    if (error) {
      toast.error("Couldn't delete conversation", { description: error.message });
      return;
    }
    if (activeConversationId === conversation.id) navigate({ to: "/app" });
    await load();
    emitAppEvent("chat:conversation-changed");
  };

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        className="w-full justify-start"
        onClick={() => void newChat()}
        loading={creating}
      >
        {creating ? null : <Plus className="size-4" />}
        {creating ? "Starting…" : "New chat"}
      </Button>

      <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 text-muted-foreground focus-within:border-ring">
        <Search className="size-4 shrink-0" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations"
          aria-label="Search conversations"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      {loading ? (
        <div className="space-y-1 px-1" role="status" aria-label="Loading conversations">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          size="sm"
          icon={MessageSquare}
          title={query.trim() ? "No matches" : "No conversations yet"}
          description={
            query.trim()
              ? `Nothing matches "${query.trim()}".`
              : "Start a chat and it will show up here."
          }
          action={
            query.trim() ? (
              <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
                Clear search
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="max-h-[min(46vh,28rem)] space-y-0.5 overflow-y-auto pr-0.5 scrollbar-thin">
          {items.map((conversation) => {
            const isActive = activeConversationId === conversation.id;
            const isRenaming = renamingId === conversation.id;

            return (
              <li key={conversation.id} className="group relative flex items-center">
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    value={draftTitle}
                    maxLength={TITLE_MAX}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onBlur={() => void commitRename()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setRenamingId(null);
                      }
                    }}
                    aria-label="Conversation title"
                    className="h-11 min-w-0 flex-1 rounded-lg border border-ring bg-surface-3 px-2.5 text-sm font-medium text-foreground outline-none"
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => open(conversation.id)}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "min-w-0 flex-1 rounded-lg px-2.5 py-2 pr-10 text-left transition-colors",
                        isActive
                          ? "bg-surface-2 text-foreground"
                          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        {conversation.is_pinned ? (
                          <Pin className="size-3.5 shrink-0 text-primary" aria-label="Pinned" />
                        ) : (
                          <MessageSquare className="size-3.5 shrink-0 opacity-70" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {conversation.title}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate pl-[22px] text-xs text-muted-foreground/80">
                        {conversation.preview?.trim() || "No messages yet"} ·{" "}
                        {relativeTime(conversation.updated_at)}
                      </span>
                    </button>

                    {/* 36px hit area rather than the 24px it used to be, and
                        always reachable: hiding the trigger behind :hover left
                        touch users with no way to manage a conversation. */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Actions for ${conversation.title}`}
                          className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:opacity-100 data-[state=open]:bg-surface-3 data-[state=open]:text-foreground md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                        >
                          <MoreHorizontal className="size-4" aria-hidden />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onSelect={() => startRename(conversation)}>
                          <Pencil className="size-4" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            void update(conversation.id, { is_pinned: !conversation.is_pinned })
                          }
                        >
                          <Pin className="size-4" />
                          {conversation.is_pinned ? "Unpin" : "Pin to top"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => setPendingDelete(conversation)}
                        >
                          <Trash className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{pendingDelete?.title}&rdquo; and every message in it will be removed. This
              can&rsquo;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete conversation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
