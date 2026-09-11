// notes-store.ts — per-workspace sticky notes, persisted in localStorage.
//
// NotesPanel owns the interactive editing; other surfaces (the client portal's
// "Save to Memory") add notes through `appendNote`, which writes storage
// directly — so the note is kept even when no NotesPanel is mounted — and then
// emits `notes:changed` so a mounted panel re-reads.
import { emitAppEvent } from "@/lib/app-events";

export const NOTE_COLORS = ["sand", "mint", "sky", "lilac", "rose", "slate"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface Note {
  id: string;
  text: string;
  color: NoteColor;
  pinned: boolean;
  updatedAt: number;
}

const NOTES_PREFIX = "raval:notes:v1:";
const notesKey = (wsId: string) => `${NOTES_PREFIX}${wsId}`;

export const newNoteId = () =>
  `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function readNotes(wsId: string): Note[] {
  try {
    const raw = localStorage.getItem(notesKey(wsId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Note[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persist without notifying — NotesPanel calls this on every edit. */
export function writeNotes(wsId: string, notes: Note[]): void {
  try {
    localStorage.setItem(notesKey(wsId), JSON.stringify(notes));
  } catch {
    // Storage full or disabled: the in-memory panel state still holds the note.
  }
}

/** Add a note from outside the panel. Returns false if storage is unavailable. */
export function appendNote(
  wsId: string,
  input: { text: string; color?: NoteColor; pinned?: boolean },
): boolean {
  const note: Note = {
    id: newNoteId(),
    text: input.text,
    color: input.color ?? "sand",
    pinned: input.pinned ?? false,
    updatedAt: Date.now(),
  };
  const next = [note, ...readNotes(wsId)];
  writeNotes(wsId, next);
  const saved = readNotes(wsId).some((n) => n.id === note.id);
  if (saved) emitAppEvent("notes:changed", { workspaceId: wsId });
  return saved;
}
