"use client";

import { Spinner } from "@/components/icons";
import { conversationPath, workspacePath } from "@/lib/workspace/paths";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@/lib/navigation";
import {
  ChevronDown,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash,
  X,
} from "@/components/icons";
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

/** Recents shown before "Show more"; each "Show more" reveals ten more. */
const RECENTS_PAGE = 5;
const RECENTS_OPEN_KEY = "app:recentsOpen";

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
  const [visibleCount, setVisibleCount] = useState(RECENTS_PAGE);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    try {
      if (window.localStorage.getItem(RECENTS_OPEN_KEY) === "0") setRecentsOpen(false);
    } catch {
      // Storage unavailable — keep the list open.
    }
  }, []);

  const toggleRecents = () => {
    const next = !recentsOpen;
    setRecentsOpen(next);
    try {
      window.localStorage.setItem(RECENTS_OPEN_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable — the toggle still works for this visit.
    }
  };

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

  const searching = query.trim().length > 0;
  const pinned = searching ? [] : items.filter((item) => item.is_pinned);
  const recents = searching ? items : items.filter((item) => !item.is_pinned);
  // Keep the open chat visible even when it sits past the collapsed cut-off.
  const activeIndex = recents.findIndex((item) => item.id === activeConversationId);
  const shownCount = searching ? recents.length : Math.max(visibleCount, activeIndex + 1);
  const shownRecents = recents.slice(0, shownCount);
  const hiddenCount = recents.length - shownRecents.length;

  const renderRow = (conversation: Conversation) => {
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
            className="h-8 w-full rounded-lg bg-[var(--ds-well-bg)] px-2.5 text-[13px] text-foreground outline-none ring-1 ring-primary/50"
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => open(conversation.id)}
              aria-current={isActive ? "page" : undefined}
              title={conversation.title}
              className={cn(
                "relative flex h-8 w-full items-center rounded-lg px-2.5 text-left text-[13px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                isActive
                  ? "bg-[var(--ds-well-bg)] font-medium text-foreground before:absolute before:left-0 before:top-1/2 before:h-3.5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-primary"
                  : "text-foreground/70 hover:bg-[var(--ds-well-bg)] hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "min-w-0 flex-1 truncate py-0.5",
                  isActive ? "pr-6" : "max-md:pr-6 md:group-focus-within:pr-6 md:group-hover:pr-6",
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
                    "absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-opacity hover:bg-foreground/[0.06] hover:text-foreground data-[state=open]:bg-foreground/[0.06] data-[state=open]:text-foreground data-[state=open]:opacity-100",
                    !isActive &&
                      "md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100",
                  )}
                >
                  <MoreHorizontal className="size-3.5" aria-hidden />
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
  };

  const sectionLabel = "px-2.5 pb-1 text-[11px] font-medium text-muted-foreground/70";

  return (
    <div className="flex flex-col gap-px">
      <button
        type="button"
        onClick={newChat}
        className="group flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13px] font-medium text-foreground transition-colors hover:bg-[var(--ds-well-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground transition-transform duration-200 group-hover:rotate-90">
          <Plus className="size-3" strokeWidth={2.5} />
        </span>
        New chat
      </button>

      <label className="flex h-8 items-center gap-2.5 rounded-lg px-2 text-muted-foreground transition-colors focus-within:bg-[var(--ds-well-bg)] hover:bg-[var(--ds-well-bg)]">
        <span className="grid size-5 shrink-0 place-items-center">
          <Search className="size-3.5" aria-hidden />
        </span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
          }}
          placeholder="Search chats"
          aria-label="Search chats"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        {searching ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" aria-hidden />
          </button>
        ) : null}
      </label>

      {loading && items.length === 0 ? (
        <div className="mt-3 space-y-2.5 px-2.5" role="status" aria-label="Loading chats">
          {[72, 58, 80, 46, 64].map((w) => (
            <div
              key={w}
              className="h-3 animate-pulse rounded-full bg-foreground/[0.07]"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="px-2.5 pt-3 text-[12px] text-muted-foreground">
          {searching ? "No chats found" : "Your chats will show up here"}
        </p>
      ) : (
        <>
          {pinned.length > 0 ? (
            <section className="mt-3">
              <h4 className={sectionLabel}>Pinned</h4>
              <ul className="flex flex-col gap-px">{pinned.map(renderRow)}</ul>
            </section>
          ) : null}

          {recents.length > 0 ? (
            <section className="mt-3">
              {searching ? (
                <h4 className={sectionLabel}>Results</h4>
              ) : (
                <button
                  type="button"
                  onClick={toggleRecents}
                  aria-expanded={recentsOpen}
                  className="group/recents flex w-full items-center gap-1 rounded-md px-2.5 pb-1 text-left text-[11px] font-medium text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
                >
                  Recents
                  <ChevronDown
                    className={cn(
                      "size-3 transition-all",
                      recentsOpen
                        ? "opacity-0 group-hover/recents:opacity-100 group-focus-visible/recents:opacity-100"
                        : "-rotate-90",
                    )}
                    aria-hidden
                  />
                </button>
              )}

              {searching || recentsOpen ? (
                <>
                  <ul className="flex flex-col gap-px">{shownRecents.map(renderRow)}</ul>
                  {!searching && (hiddenCount > 0 || shownCount > RECENTS_PAGE) ? (
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleCount(
                          hiddenCount > 0 ? shownCount + RECENTS_PAGE * 2 : RECENTS_PAGE,
                        )
                      }
                      className="mt-px flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[12.5px] text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      <ChevronDown
                        className={cn("size-3.5", hiddenCount === 0 && "rotate-180")}
                        aria-hidden
                      />
                      {hiddenCount > 0 ? "Show more" : "Show less"}
                    </button>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}
        </>
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
              {deleting ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden /> Deleting…
                </span>
              ) : (
                "Delete conversation"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
