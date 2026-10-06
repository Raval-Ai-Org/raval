"use client";
// NotesBoard — the workspace's notes, in Brain → Home → Notes.
//
// A board of cards: write at the top, pinned notes first, everything else
// below on an even grid. Notes live in this browser (src/lib/notes-store.ts),
// the same store the client portal's "Save to Memory" writes to.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Pin, Plus, Search, StickyNote, Trash2, X } from "@/components/ui/gemini-icons";
import { dsFocus, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { useAppEvent } from "@/hooks/use-app-event";
import {
  NOTE_COLORS,
  newNoteId,
  readNotes,
  writeNotes,
  type Note,
  type NoteColor,
} from "@/lib/notes-store";
import { cn } from "@/lib/utils";

const EASE = [0.16, 1, 0.3, 1] as const;

/** A note's colour: a soft card fill and the dot that picks it. */
const COLOR: Record<NoteColor, { card: string; dot: string; label: string }> = {
  sand: { card: "bg-amber-400/[0.10] ring-amber-500/20", dot: "bg-amber-400", label: "Sand" },
  mint: { card: "bg-emerald-400/[0.10] ring-emerald-500/20", dot: "bg-emerald-400", label: "Mint" },
  sky: { card: "bg-sky-400/[0.10] ring-sky-500/20", dot: "bg-sky-400", label: "Sky" },
  lilac: { card: "bg-violet-400/[0.10] ring-violet-500/20", dot: "bg-violet-400", label: "Lilac" },
  rose: { card: "bg-rose-400/[0.10] ring-rose-500/20", dot: "bg-rose-400", label: "Rose" },
  slate: { card: "bg-slate-400/[0.10] ring-slate-500/20", dot: "bg-slate-400", label: "Grey" },
};

function when(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 30
    ? `${days}d`
    : new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ColorDots({
  value,
  onChange,
  size = "h-4 w-4",
}: {
  value: NoteColor;
  onChange: (color: NoteColor) => void;
  size?: string;
}) {
  return (
    <span className="flex items-center gap-1.5" role="radiogroup" aria-label="Colour">
      {NOTE_COLORS.map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={value === name}
          aria-label={COLOR[name].label}
          title={COLOR[name].label}
          onClick={() => onChange(name)}
          className={cn(
            "rounded-full transition-transform hover:scale-110",
            size,
            COLOR[name].dot,
            value === name
              ? "ring-2 ring-foreground/60 ring-offset-2 ring-offset-background"
              : "opacity-70",
            dsFocus,
          )}
        />
      ))}
    </span>
  );
}

/** A textarea that is as tall as its text. */
function AutoText({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (text: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useEffect(fit, [fit, value]);
  return (
    <textarea
      ref={ref}
      defaultValue={value}
      key={value}
      rows={1}
      onInput={fit}
      onBlur={(e) => onCommit(e.target.value.trim())}
      aria-label="Note"
      className={cn(
        "block w-full resize-none overflow-hidden bg-transparent text-[13.5px] leading-relaxed text-foreground outline-none",
        className,
      )}
    />
  );
}

function NoteCard({
  note,
  onUpdate,
  onRemove,
}: {
  note: Note;
  onUpdate: (patch: Partial<Note>) => void;
  onRemove: () => void;
}) {
  const color = COLOR[note.color] ?? COLOR.sand;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.22, ease: EASE }}
      className={cn(
        "group flex h-full min-h-[112px] flex-col rounded-[18px] p-4 ring-1 transition-shadow focus-within:ring-2 hover:shadow-sm",
        color.card,
      )}
    >
      <AutoText
        value={note.text}
        onCommit={(text) => {
          if (!text) onRemove();
          else if (text !== note.text) onUpdate({ text });
        }}
      />
      <div className="mt-auto flex h-10 items-end justify-between gap-2">
        <span className="text-[11px] tabular-nums text-muted-foreground group-focus-within:hidden group-hover:hidden">
          {when(note.updatedAt)}
        </span>
        <span className="hidden group-focus-within:flex group-hover:flex">
          <ColorDots
            value={note.color}
            onChange={(c) => onUpdate({ color: c })}
            size="h-3.5 w-3.5"
          />
        </span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onUpdate({ pinned: !note.pinned })}
            aria-label={note.pinned ? "Unpin" : "Pin"}
            aria-pressed={note.pinned}
            title={note.pinned ? "Unpin" : "Pin"}
            className={cn(
              dsIconBtn,
              "h-7 w-7",
              note.pinned
                ? "text-foreground"
                : "opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100",
            )}
          >
            <Pin className={cn("h-3.5 w-3.5", note.pinned && "fill-current")} />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Delete note"
            title="Delete"
            className={cn(
              dsIconBtn,
              "h-7 w-7 opacity-0 hover:text-destructive focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100",
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </motion.li>
  );
}

function Board({
  label,
  notes,
  onUpdate,
  onRemove,
}: {
  label?: string;
  notes: Note[];
  onUpdate: (id: string, patch: Partial<Note>) => void;
  onRemove: (id: string) => void;
}) {
  if (!notes.length) return null;
  return (
    <div>
      {label && <h3 className="ds-label mb-2.5 px-1">{label}</h3>}
      <ul className="grid auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence initial={false}>
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onUpdate={(patch) => onUpdate(note.id, patch)}
              onRemove={() => onRemove(note.id)}
            />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

export function NotesBoard({ workspaceId }: { workspaceId: string }) {
  const [notes, setNotes] = useState<Note[]>(() => readNotes(workspaceId));
  const [text, setText] = useState("");
  const [color, setColor] = useState<NoteColor>("sand");
  const [query, setQuery] = useState("");
  const composer = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => setNotes(readNotes(workspaceId)), [workspaceId]);
  // Notes added elsewhere (e.g. the client portal's "Save to Memory").
  useAppEvent("notes:changed", (event) => {
    if (event.detail.workspaceId === workspaceId) setNotes(readNotes(workspaceId));
  });
  useEffect(() => writeNotes(workspaceId, notes), [workspaceId, notes]);

  const add = useCallback(() => {
    const body = text.trim();
    if (!body) return;
    setNotes((prev) => [
      { id: newNoteId(), text: body, color, pinned: false, updatedAt: Date.now() },
      ...prev,
    ]);
    setText("");
    composer.current?.focus();
  }, [text, color]);

  const update = useCallback((id: string, patch: Partial<Note>) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)),
    );
  }, []);
  const remove = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...notes]
      .filter((n) => !q || n.text.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [notes, query]);
  const pinned = shown.filter((n) => n.pinned);
  const others = shown.filter((n) => !n.pinned);

  return (
    <div className="space-y-6">
      {/* ── write ── */}
      <div
        className={cn(
          "rounded-[20px] p-4 ring-1 transition-shadow focus-within:shadow-sm focus-within:ring-2",
          COLOR[color].card,
        )}
      >
        <textarea
          ref={composer}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              add();
            }
          }}
          rows={2}
          placeholder="Write a note…"
          aria-label="New note"
          className="block w-full resize-none bg-transparent text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        <div className="mt-2 flex h-9 items-center justify-between gap-3">
          <ColorDots value={color} onChange={setColor} />
          <button
            type="button"
            onClick={add}
            disabled={!text.trim()}
            className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>

      {/* ── find ── */}
      {notes.length > 0 && (
        <div className="flex h-9 items-center gap-3">
          <label className="ds-well relative flex h-9 min-w-0 flex-1 items-center rounded-full sm:max-w-[320px]">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search notes"
              className="h-full w-full bg-transparent pl-9 pr-9 text-[13px] outline-none placeholder:text-muted-foreground/70"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </label>
          <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
            {shown.length} {shown.length === 1 ? "note" : "notes"}
          </span>
        </div>
      )}

      {/* ── the board ── */}
      {shown.length === 0 ? (
        <div className="grid place-items-center rounded-[20px] border border-dashed border-border/70 px-4 py-14 text-center">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/12 text-primary">
            {query ? <Search className="h-5 w-5" /> : <StickyNote className="h-5 w-5" />}
          </span>
          <p className="mt-3 text-[14px] font-medium">{query ? "No match" : "No notes yet"}</p>
        </div>
      ) : (
        <div className="space-y-6">
          <Board
            label={others.length ? "Pinned" : undefined}
            notes={pinned}
            onUpdate={update}
            onRemove={remove}
          />
          <Board
            label={pinned.length ? "Notes" : undefined}
            notes={others}
            onUpdate={update}
            onRemove={remove}
          />
        </div>
      )}
      <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-muted-foreground">
        <Check className="h-3 w-3" /> Saved on this device
      </p>
    </div>
  );
}
