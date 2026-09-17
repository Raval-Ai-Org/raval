"use client";

import { conversationPath, workspacePath } from "@/lib/workspace/paths";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@/lib/navigation";
import { MoreHorizontal, Pencil, Pin, Plus, Search, Trash } from "@/components/icons";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
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

/** Pinned first, then Today / Yesterday / Previous 7 days / Previous 30 days / Older. */
function groupByDate(items: Conversation[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime();
  const day = 86_400_000;
  const order = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];
  const buckets = new Map<string, Conversation[]>();
  for (const item of items) {
    const t = new Date(item.updated_at).getTime();
    const label = item.is_pinned
      ? "Pinned"
      : t >= start
        ? "Today"
        : t >= start - day
          ? "Yesterday"
          : t >= start - 7 * day
            ? "Previous 7 days"
            : t >= start - 30 * day
              ? "Previous 30 days"
              : "Older";
    buckets.set(label, [...(buckets.get(label) ?? []), item]);
  }
  return order
    .filter((label) => buckets.has(label))
    .map((label) => ({ label, items: buckets.get(label) ?? [] }));
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

  // Opens a fresh chat page. The conversation row is created when the first
  // message is sent, so empty "New chat" entries never pile up in the list.
  const newChat = () => {
    if (!workspaceId) return;
    onNavigate?.();
    navigate({ to: workspacePath(workspaceId) });
    emitAppEvent("chat:focus");
  };

  const open = (id: string) => {
    onNavigate?.();
    if (!workspaceId) return;
    navigate({ to: conversationPath(workspaceId, id) });
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
    if (activeConversationId === conversation.id) navigate({ to: workspacePath(workspaceId) });
    await load();
    emitAppEvent("chat:conversation-changed");
  };

  const groups = groupByDate(items);

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={newChat}
        className="group flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px] font-medium text-foreground transition-colors hover:bg-foreground/[0.06]"
      >
        <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground transition-transform group-hover:rotate-90">
          <Plus className="size-3.5" strokeWidth={2.5} />
        </span>
        New chat
      </button>

      <label className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-muted-foreground transition-colors focus-within:bg-foreground/[0.06] hover:bg-foreground/[0.06]">
        <Search className="size-4 shrink-0" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chats"
          aria-label="Search chats"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      {loading && items.length === 0 ? (
        <div className="mt-3 space-y-2 px-2.5" role="status" aria-label="Loading chats">
          {[70, 55, 80, 45].map((w) => (
            <div
              key={w}
              className="h-3.5 animate-pulse rounded-full bg-foreground/[0.07]"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="px-2.5 pt-3 text-[12.5px] text-muted-foreground">
          {query.trim() ? "No chats found" : "Your chats will show up here"}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="mt-3">
            <h4 className="px-2.5 pb-1 text-[11.5px] font-medium text-muted-foreground/80">
              {group.label}
            </h4>
            <ul className="flex flex-col gap-px">
              {group.items.map((conversation) => {
                const isActive = activeConversationId === conversation.id;
                const isRenaming = renamingId === conversation.id;
                return (
                  <li key={conversation.id} className="group relative">
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
                        aria-label="Chat title"
                        className="h-9 w-full rounded-lg bg-foreground/[0.06] px-2.5 text-[13.5px] text-foreground outline-none ring-1 ring-ring"
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => open(conversation.id)}
                          aria-current={isActive ? "page" : undefined}
                          title={conversation.title}
                          className={cn(
                            "flex h-9 w-full items-center rounded-lg px-2.5 text-left text-[13.5px] transition-colors",
                            isActive
                              ? "bg-foreground/[0.08] font-medium text-foreground"
                              : "text-foreground/80 hover:bg-foreground/[0.05] hover:text-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate",
                              isActive
                                ? "pr-7"
                                : "md:group-hover:pr-7 md:group-focus-within:pr-7 max-md:pr-7",
                            )}
                          >
                            {conversation.title}
                          </span>
                        </button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Options for ${conversation.title}`}
                              className={cn(
                                "absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-opacity hover:text-foreground data-[state=open]:text-foreground data-[state=open]:opacity-100",
                                !isActive &&
                                  "md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
                              )}
                            >
                              <MoreHorizontal className="size-4" aria-hidden />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-40">
                            <DropdownMenuItem onSelect={() => startRename(conversation)}>
                              <Pencil className="size-4" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                void update(conversation.id, {
                                  is_pinned: !conversation.is_pinned,
                                })
                              }
                            >
                              <Pin className="size-4" />
                              {conversation.is_pinned ? "Unpin" : "Pin"}
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
          </section>
        ))
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
