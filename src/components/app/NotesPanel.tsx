"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  Plus,
  Pin,
  Trash2,
  StickyNote,
  Check,
  X,
  Search,
} from "@/components/ui/gemini-icons";
import { cn } from "@/lib/utils";

/* -------------------- Storage -------------------- */

const NOTES_PREFIX = "raval:notes:v1:";
const OPEN_PREFIX = "raval:notes:open:v1:";
const notesKey = (wsId: string) => `${NOTES_PREFIX}${wsId}`;
const openKey = (wsId: string) => `${OPEN_PREFIX}${wsId}`;

const PALETTE = [
  {
    name: "sand",
    bg: "bg-amber-50 dark:bg-amber-500/10",
    ring: "ring-amber-200/60 dark:ring-amber-500/20",
  },
  {
    name: "mint",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    ring: "ring-emerald-200/60 dark:ring-emerald-500/20",
  },
  { name: "sky", bg: "bg-sky-50 dark:bg-sky-500/10", ring: "ring-sky-200/60 dark:ring-sky-500/20" },
  {
    name: "lilac",
    bg: "bg-violet-50 dark:bg-violet-500/10",
    ring: "ring-violet-200/60 dark:ring-violet-500/20",
  },
  {
    name: "rose",
    bg: "bg-rose-50 dark:bg-rose-500/10",
    ring: "ring-rose-200/60 dark:ring-rose-500/20",
  },
  {
    name: "slate",
    bg: "bg-slate-50 dark:bg-slate-500/10",
    ring: "ring-slate-200/60 dark:ring-slate-500/20",
  },
] as const;
type PaletteName = (typeof PALETTE)[number]["name"];

interface Note {
  id: string;
  text: string;
  color: PaletteName;
  pinned: boolean;
  updatedAt: number;
}

function readNotes(wsId: string): Note[] {
  try {
    const raw = localStorage.getItem(notesKey(wsId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Note[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeNotes(wsId: string, notes: Note[]) {
  try {
    localStorage.setItem(notesKey(wsId), JSON.stringify(notes));
  } catch {}
}
function readOpen(wsId: string): boolean {
  try {
    return localStorage.getItem(openKey(wsId)) === "1";
  } catch {
    return false;
  }
}
function writeOpen(wsId: string, v: boolean) {
  try {
    localStorage.setItem(openKey(wsId), v ? "1" : "0");
  } catch {}
}

const rid = () => `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/* -------------------- Panel -------------------- */

export function NotesPanel({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState<boolean>(() => readOpen(workspaceId));
  const [notes, setNotes] = useState<Note[]>(() => readNotes(workspaceId));
  const [composerText, setComposerText] = useState("");
  const [composerColor, setComposerColor] = useState<PaletteName>("sand");
  const [composerActive, setComposerActive] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setNotes(readNotes(workspaceId));
    setOpen(readOpen(workspaceId));
  }, [workspaceId]);
  useEffect(() => writeNotes(workspaceId, notes), [workspaceId, notes]);
  useEffect(() => writeOpen(workspaceId, open), [workspaceId, open]);

  const sorted = useMemo(() => {
    return [...notes].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [notes]);

  const pinnedCount = notes.filter((n) => n.pinned).length;

  const addNote = useCallback(() => {
    const text = composerText.trim();
    if (!text) {
      setComposerActive(false);
      return;
    }
    const n: Note = {
      id: rid(),
      text,
      color: composerColor,
      pinned: false,
      updatedAt: Date.now(),
    };
    setNotes((prev) => [n, ...prev]);
    setComposerText("");
    setComposerColor("sand");
    setComposerActive(false);
  }, [composerText, composerColor]);

  const updateNote = useCallback((id: string, patch: Partial<Note>) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)),
    );
  }, []);

  const removeNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return (
    <motion.div
      layout
      className="relative overflow-hidden border-t border-border/60 bg-background/50"
    >
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="notes-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="px-3 pb-3 pt-2">
              {/* Composer */}
              <div
                className={cn(
                  "rounded-xl ring-1 transition-all",
                  PALETTE.find((p) => p.name === composerColor)?.bg,
                  PALETTE.find((p) => p.name === composerColor)?.ring,
                  composerActive ? "shadow-sm" : "",
                )}
              >
                <textarea
                  ref={composerRef}
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  onFocus={() => setComposerActive(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      addNote();
                    }
                    if (e.key === "Escape") {
                      setComposerActive(false);
                      composerRef.current?.blur();
                    }
                  }}
                  placeholder={
                    composerActive ? "Jot a thought… (⌘/Ctrl+Enter to save)" : "Take a note…"
                  }
                  rows={composerActive ? 3 : 1}
                  className="block w-full resize-none rounded-xl bg-transparent px-3 py-2 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
                />
                {composerActive && (
                  <div className="flex items-center justify-between gap-2 px-2 pb-2">
                    <div className="flex items-center gap-1">
                      {PALETTE.map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          onClick={() => setComposerColor(p.name)}
                          aria-label={`Color ${p.name}`}
                          className={cn(
                            "h-4 w-4 rounded-full ring-1 transition-transform hover:scale-110",
                            p.bg,
                            p.ring,
                            composerColor === p.name && "ring-2 ring-foreground/40",
                          )}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setComposerText("");
                          setComposerActive(false);
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" /> Cancel
                      </button>
                      <button
                        type="button"
                        onClick={addNote}
                        disabled={!composerText.trim()}
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-2.5 text-[11.5px] font-medium text-background transition disabled:opacity-40"
                      >
                        <Check className="h-3.5 w-3.5" /> Save
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Notes grid */}
              {sorted.length === 0 ? (
                <div className="mt-3 flex items-center justify-center rounded-xl border border-dashed border-border/60 px-3 py-6 text-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <StickyNote className="h-4 w-4 text-muted-foreground/70" />
                    <p className="text-[12px] text-muted-foreground">
                      No notes yet — jot ideas, hooks, or reminders here.
                    </p>
                  </div>
                </div>
              ) : (
                <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <AnimatePresence initial={false}>
                    {sorted.map((n) => {
                      const p = PALETTE.find((x) => x.name === n.color) ?? PALETTE[0];
                      return (
                        <motion.li
                          key={n.id}
                          layout
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ duration: 0.16 }}
                          className={cn(
                            "group relative rounded-xl px-3 py-2.5 ring-1 transition-shadow hover:shadow-sm",
                            p.bg,
                            p.ring,
                          )}
                        >
                          <textarea
                            defaultValue={n.text}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (!v) removeNote(n.id);
                              else if (v !== n.text) updateNote(n.id, { text: v });
                            }}
                            rows={Math.min(6, Math.max(1, n.text.split("\n").length))}
                            className="block w-full resize-none bg-transparent text-[13px] leading-relaxed text-foreground focus:outline-none"
                          />
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-0.5">
                              {PALETTE.map((c) => (
                                <button
                                  key={c.name}
                                  type="button"
                                  onClick={() => updateNote(n.id, { color: c.name })}
                                  aria-label={`Color ${c.name}`}
                                  className={cn(
                                    "h-3 w-3 rounded-full opacity-0 ring-1 transition group-hover:opacity-100 hover:scale-110",
                                    c.bg,
                                    c.ring,
                                    n.color === c.name && "opacity-100 ring-2 ring-foreground/40",
                                  )}
                                />
                              ))}
                            </div>
                            <div className="flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => updateNote(n.id, { pinned: !n.pinned })}
                                aria-label={n.pinned ? "Unpin" : "Pin"}
                                title={n.pinned ? "Unpin" : "Pin"}
                                className={cn(
                                  "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground",
                                  n.pinned && "text-foreground",
                                )}
                              >
                                <Pin className={cn("h-3.5 w-3.5", n.pinned && "fill-current")} />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeNote(n.id)}
                                aria-label="Delete note"
                                title="Delete"
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-secondary/60 hover:text-foreground group-hover:opacity-100"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              )}
            </div>
            <div className="h-px bg-border/60" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header row */}
      <div className="flex items-center gap-1.5 px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-secondary/60"
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br from-amber-500/20 via-rose-500/15 to-violet-500/20 text-amber-600 dark:text-amber-400">
            <StickyNote className="h-3.5 w-3.5" />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="shrink-0 text-[12px] font-semibold tracking-tight text-foreground">
              Notes
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {notes.length === 0
                ? "· Jot ideas, hooks & reminders"
                : `· ${notes.length} note${notes.length === 1 ? "" : "s"}${pinnedCount ? ` · ${pinnedCount} pinned` : ""}`}
            </span>
          </span>
          {!open && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(true);
                requestAnimationFrame(() => {
                  composerRef.current?.focus();
                  setComposerActive(true);
                });
              }}
              aria-label="Add note"
              title="Add note"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              open ? "rotate-180" : "-rotate-90",
            )}
          />
        </button>
      </div>
    </motion.div>
  );
}

export default NotesPanel;

/* -------------------- Embeddable body (for tabs) -------------------- */

export function NotesTabBody({ workspaceId }: { workspaceId: string }) {
  const [notes, setNotes] = useState<Note[]>(() => readNotes(workspaceId));
  const [composerText, setComposerText] = useState("");
  const [composerColor, setComposerColor] = useState<PaletteName>("sand");
  const [composerActive, setComposerActive] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setNotes(readNotes(workspaceId));
  }, [workspaceId]);
  useEffect(() => writeNotes(workspaceId, notes), [workspaceId, notes]);

  const sorted = useMemo(
    () =>
      [...notes].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      }),
    [notes],
  );

  const addNote = useCallback(() => {
    const text = composerText.trim();
    if (!text) {
      setComposerActive(false);
      return;
    }
    const n: Note = {
      id: rid(),
      text,
      color: composerColor,
      pinned: false,
      updatedAt: Date.now(),
    };
    setNotes((prev) => [n, ...prev]);
    setComposerText("");
    setComposerColor("sand");
    setComposerActive(false);
  }, [composerText, composerColor]);

  const updateNote = useCallback((id: string, patch: Partial<Note>) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)),
    );
  }, []);

  const removeNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((n) => n.text.toLowerCase().includes(q));
  }, [sorted, query]);

  const pinned = filtered.filter((n) => n.pinned);
  const others = filtered.filter((n) => !n.pinned);
  const activeSwatch = PALETTE.find((p) => p.name === composerColor) ?? PALETTE[0];

  return (
    <div className="space-y-2.5">
      {/* Toolbar: search + count — matches coach panel density */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/70" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes"
            className="h-7 w-full rounded-lg bg-secondary/50 pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground/70 outline-none ring-0 transition focus:bg-secondary/70"
          />
        </div>
        <span className="shrink-0 rounded-md bg-secondary/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
          {notes.length}
        </span>
      </div>

      {/* Composer */}
      <div
        className={cn(
          "group/composer relative overflow-hidden rounded-xl transition-all",
          "bg-card/60",
          "ring-1 ring-border/60",
          composerActive
            ? "ring-foreground/15 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_18px_-12px_rgba(0,0,0,0.08)]"
            : "hover:ring-foreground/10",
        )}
      >
        {/* Accent stripe reflecting composer color */}
        <div
          aria-hidden
          className={cn(
            "absolute inset-x-0 top-0 h-[2px] transition-opacity",
            activeSwatch.bg,
            composerActive ? "opacity-100" : "opacity-60",
          )}
        />
        <div className="flex items-start gap-2 px-2.5 pt-2.5">
          <div
            className={cn(
              "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md ring-1 transition-colors",
              activeSwatch.bg,
              activeSwatch.ring,
            )}
          >
            <StickyNote className="h-3 w-3 text-foreground/70" />
          </div>
          <textarea
            ref={composerRef}
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            onFocus={() => setComposerActive(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                addNote();
              }
              if (e.key === "Escape") {
                setComposerActive(false);
                composerRef.current?.blur();
              }
            }}
            placeholder={composerActive ? "Jot a thought… ⌘/Ctrl+Enter to save" : "Take a note…"}
            rows={composerActive ? 3 : 1}
            className="block min-h-[22px] w-full resize-none bg-transparent py-0.5 text-[12.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
        </div>

        <AnimatePresence initial={false}>
          {composerActive && (
            <motion.div
              key="composer-actions"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/50 px-2.5 py-1.5">
                <div className="flex items-center gap-1">
                  {PALETTE.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => setComposerColor(p.name)}
                      aria-label={`Color ${p.name}`}
                      title={p.name}
                      className={cn(
                        "h-3.5 w-3.5 rounded-full ring-1 transition-all hover:scale-110",
                        p.bg,
                        p.ring,
                        composerColor === p.name && "scale-110 ring-2 ring-foreground/50",
                      )}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setComposerText("");
                      setComposerActive(false);
                    }}
                    className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground transition hover:bg-secondary/60 hover:text-foreground"
                  >
                    <X className="h-3 w-3" /> Cancel
                  </button>
                  <button
                    type="button"
                    onClick={addNote}
                    disabled={!composerText.trim()}
                    className="inline-flex h-6 items-center gap-1 rounded-md bg-foreground px-2 text-[11px] font-medium text-background transition hover:bg-foreground/90 disabled:opacity-40"
                  >
                    <Check className="h-3 w-3" /> Save
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Notes */}
      {filtered.length === 0 ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border/60 bg-card/30 px-4 py-8 text-center">
          <div className="flex flex-col items-center gap-1.5">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-amber-500/15 via-rose-500/10 to-violet-500/15 ring-1 ring-border/60">
              <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className="text-[12px] font-medium text-foreground">
              {query ? "No notes match your search" : "Your notebook is empty"}
            </p>
            <p className="max-w-[220px] text-[11px] leading-relaxed text-muted-foreground">
              {query
                ? "Try a different keyword or clear the search."
                : "Capture ideas, hooks, reminders. ⌘/Ctrl+Enter to save."}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {pinned.length > 0 && (
            <NotesSection
              label="Pinned"
              items={pinned}
              onUpdate={updateNote}
              onRemove={removeNote}
            />
          )}
          {others.length > 0 && (
            <NotesSection
              label={pinned.length > 0 ? "Others" : undefined}
              items={others}
              onUpdate={updateNote}
              onRemove={removeNote}
            />
          )}
        </div>
      )}
    </div>
  );
}

function NotesSection({
  label,
  items,
  onUpdate,
  onRemove,
}: {
  label?: string;
  items: Note[];
  onUpdate: (id: string, patch: Partial<Note>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center gap-2 px-0.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </span>
          <span className="h-px flex-1 bg-border/60" />
        </div>
      )}
      <ul className="grid grid-cols-1 gap-1.5">
        <AnimatePresence initial={false}>
          {items.map((n) => {
            const p = PALETTE.find((x) => x.name === n.color) ?? PALETTE[0];
            return (
              <motion.li
                key={n.id}
                layout
                initial={{ opacity: 0, y: 4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "group relative overflow-hidden rounded-2xl ring-1 transition-all",
                  "hover:-translate-y-[1px] hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_24px_-14px_rgba(0,0,0,0.12)]",
                  p.bg,
                  p.ring,
                )}
              >
                {n.pinned && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-foreground/8 text-foreground/70"
                  >
                    <Pin className="h-3 w-3 fill-current" />
                  </span>
                )}
                <textarea
                  defaultValue={n.text}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (!v) onRemove(n.id);
                    else if (v !== n.text) onUpdate(n.id, { text: v });
                  }}
                  rows={Math.min(6, Math.max(1, n.text.split("\n").length))}
                  className="block w-full resize-none bg-transparent px-3 pb-1.5 pt-2.5 pr-8 text-[13px] leading-relaxed text-foreground focus:outline-none"
                />
                <div className="flex items-center justify-between gap-2 px-2 pb-2">
                  <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    {PALETTE.map((c) => (
                      <button
                        key={c.name}
                        type="button"
                        onClick={() => onUpdate(n.id, { color: c.name })}
                        aria-label={`Color ${c.name}`}
                        className={cn(
                          "h-3 w-3 rounded-full ring-1 transition hover:scale-110",
                          c.bg,
                          c.ring,
                          n.color === c.name && "ring-2 ring-foreground/50",
                        )}
                      />
                    ))}
                  </div>
                  <div className="ml-auto flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => onUpdate(n.id, { pinned: !n.pinned })}
                      aria-label={n.pinned ? "Unpin" : "Pin"}
                      title={n.pinned ? "Unpin" : "Pin"}
                      className={cn(
                        "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-foreground/8 hover:text-foreground",
                        n.pinned && "text-foreground",
                      )}
                    >
                      <Pin className={cn("h-3.5 w-3.5", n.pinned && "fill-current")} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(n.id)}
                      aria-label="Delete note"
                      title="Delete"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-foreground/8 hover:text-foreground group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}
