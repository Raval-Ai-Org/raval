"use client";

// Whether the Studio panel (the right-hand rail) is showing, and how many
// pieces finished while it was closed. The rail is the one place creation
// progress is shown; while it is closed the Studio button carries that state.
import { useSyncExternalStore } from "react";

export type StudioRailState = { open: boolean; unseen: number };

let state: StudioRailState = { open: false, unseen: 0 };
const listeners = new Set<() => void>();

function set(next: StudioRailState) {
  if (next.open === state.open && next.unseen === state.unseen) return;
  state = next;
  for (const l of listeners) l();
}

export function setStudioRailOpen(open: boolean) {
  // Opening the panel shows what finished, so nothing stays unseen.
  set({ open, unseen: open ? 0 : state.unseen });
}

/** A piece finished. Counted only while the panel is closed. */
export function noteStudioFinished() {
  if (!state.open) set({ ...state, unseen: state.unseen + 1 });
}

export function getStudioRailState(): StudioRailState {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot: StudioRailState = { open: false, unseen: 0 };

export function useStudioRail(): StudioRailState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => serverSnapshot,
  );
}
