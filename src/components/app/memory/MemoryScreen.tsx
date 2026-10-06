"use client";

// Settings → Memory. What the brand's team told Mellox to remember: a list a
// person can read, fix and clear. Presentational: MemoryPanel feeds it, and
// /memory-lab renders it with sample data.
import { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Brain, Check, Clock, Pencil, Pin, Plus, Search, Trash, X } from "@/components/icons";
import { GroupLabel, Tile } from "@/components/app/surface/SurfaceLayout";
import { dsIconBtn } from "@/components/app/surface/buttons";
import {
  MEMORY_MAX_CHARS,
  TEMP_DEFAULT_HOURS,
  type Memory,
  type MemoryView,
} from "@/lib/memory/contracts";
import { timeLeft } from "@/lib/memory/normalize";
import { cn } from "@/lib/utils";

export type MemoryHandlers = {
  setEnabled: (enabled: boolean) => void;
  /** `hours` null keeps it until removed. */
  add: (body: string, hours: number | null) => void;
  edit: (id: string, body: string) => void;
  /** Make a temporary memory lasting. */
  keep: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
};

const SEARCH_FROM = 7;

export function MemoryScreen({
  view,
  handlers,
  busy = false,
  now = new Date(),
}: {
  view: MemoryView;
  handlers: MemoryHandlers;
  busy?: boolean;
  now?: Date;
}) {
  const [draft, setDraft] = useState("");
  const [temporary, setTemporary] = useState(false);
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? view.memories.filter((m) => m.body.toLowerCase().includes(q)) : view.memories;
  }, [view.memories, query]);
  const always = shown.filter((m) => !m.expiresAt);
  const forNow = shown.filter((m) => m.expiresAt);
  const full = view.memories.length >= view.limit;

  const add = () => {
    const body = draft.trim();
    if (body.length < 3) return;
    handlers.add(body, temporary ? TEMP_DEFAULT_HOURS : null);
    setDraft("");
  };

  return (
    <div data-testid="memory-screen">
      <Tile className="p-0 sm:p-0">
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <div className="text-[14px] font-medium text-foreground">Use memory</div>
            <p className="text-[12.5px] text-muted-foreground">
              Mellox remembers what your team tells it and follows it everywhere.
            </p>
          </div>
          <Switch
            checked={view.enabled}
            disabled={!view.canManage || busy}
            onCheckedChange={handlers.setEnabled}
            aria-label="Use memory"
          />
        </div>
      </Tile>
      {!view.canManage && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">Only an admin can change this.</p>
      )}

      {!view.enabled ? (
        <p className="ds-well mt-4 rounded-xl px-3 py-3 text-[13px] text-muted-foreground">
          Memory is off. Nothing new is saved and nothing below is used.
        </p>
      ) : (
        view.canEdit && (
          <Tile className="mt-3">
            <form
              className="flex flex-col gap-2 sm:flex-row sm:items-center"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={MEMORY_MAX_CHARS}
                placeholder="Something to remember, like “never use red in our images”"
                aria-label="Add a memory"
                disabled={busy || full}
                className="min-w-0 flex-1"
              />
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={temporary}
                  onClick={() => setTemporary((v) => !v)}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    temporary
                      ? "border-primary/50 bg-primary/[0.08] text-foreground"
                      : "border-border/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Clock className="h-3.5 w-3.5" />
                  Just for a day
                </button>
                <Button type="submit" size="sm" disabled={busy || full || draft.trim().length < 3}>
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
            </form>
            {full && (
              <p className="mt-2 text-[12.5px] text-muted-foreground">
                Memory is full. Remove something to add more.
              </p>
            )}
          </Tile>
        )
      )}

      {view.memories.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={Brain}
            size="sm"
            title="Nothing remembered yet"
            description="Tell Mellox in chat, like “never use red in our images”, and it shows up here."
          />
        </div>
      ) : (
        <>
          {view.memories.length >= SEARCH_FROM && (
            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search memory"
                aria-label="Search memory"
                className="pl-9"
              />
            </div>
          )}

          {forNow.length > 0 && (
            <>
              <GroupLabel>For now</GroupLabel>
              <MemoryList
                memories={forNow}
                now={now}
                canEdit={view.canEdit}
                busy={busy}
                handlers={handlers}
              />
            </>
          )}

          {always.length > 0 && (
            <>
              <GroupLabel>Always</GroupLabel>
              <MemoryList
                memories={always}
                now={now}
                canEdit={view.canEdit}
                busy={busy}
                handlers={handlers}
              />
            </>
          )}

          {shown.length === 0 && (
            <p className="mt-4 text-[13px] text-muted-foreground">Nothing matches.</p>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted-foreground">
              {view.memories.length} of {view.limit}
            </p>
            {view.canManage && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => setConfirmClear(true)}
              >
                Clear all
              </Button>
            )}
          </div>
        </>
      )}

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all memory?</AlertDialogTitle>
            <AlertDialogDescription>
              Mellox will forget everything in this list for your whole team. This can&rsquo;t be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                handlers.clear();
                setConfirmClear(false);
              }}
            >
              Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MemoryList({
  memories,
  now,
  canEdit,
  busy,
  handlers,
}: {
  memories: Memory[];
  now: Date;
  canEdit: boolean;
  busy: boolean;
  handlers: MemoryHandlers;
}) {
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);

  return (
    <Tile className="p-0 sm:p-0">
      <ul className="divide-y divide-border/50">
        {memories.map((memory) => {
          const isEditing = editing?.id === memory.id;
          return (
            <li key={memory.id} className="px-4 py-3 sm:px-5" data-testid="memory-row">
              {isEditing ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const body = editing.body.trim();
                    if (body.length >= 3 && body !== memory.body) handlers.edit(memory.id, body);
                    setEditing(null);
                  }}
                >
                  <Textarea
                    value={editing.body}
                    onChange={(e) => setEditing({ id: memory.id, body: e.target.value })}
                    maxLength={MEMORY_MAX_CHARS}
                    rows={2}
                    autoFocus
                    aria-label="Edit memory"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(null)}
                    >
                      <X className="h-4 w-4" />
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={editing.body.trim().length < 3}>
                      <Check className="h-4 w-4" />
                      Save
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-[13.5px] leading-relaxed text-foreground">
                      {memory.body}
                    </p>
                    {memory.expiresAt && (
                      <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {timeLeft(memory.expiresAt, now)}
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      {memory.expiresAt && (
                        <button
                          type="button"
                          className={cn(dsIconBtn, "h-8 w-8")}
                          disabled={busy}
                          onClick={() => handlers.keep(memory.id)}
                          aria-label="Keep for good"
                          title="Keep for good"
                        >
                          <Pin className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        className={cn(dsIconBtn, "h-8 w-8")}
                        disabled={busy}
                        onClick={() => setEditing({ id: memory.id, body: memory.body })}
                        aria-label="Edit"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className={cn(dsIconBtn, "h-8 w-8")}
                        disabled={busy}
                        onClick={() => handlers.remove(memory.id)}
                        aria-label="Remove"
                        title="Remove"
                      >
                        <Trash className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Tile>
  );
}
