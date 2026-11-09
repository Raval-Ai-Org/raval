"use client";

// Ideas ready before anyone asks. The ideas call is a model call that takes
// 10–50 seconds; opening "Swipe ideas" used to start it and show a blank
// shimmer until it answered.
//
// - Home warms this cache when the browser is idle, and again when a pointer
//   rests on an ideas card; identical loads share one request.
// - The last batch is also kept in this browser (per workspace and format),
//   so after a reload the deck opens on it at once while a fresh batch loads
//   in the background (stale-while-revalidate).
// Suggestions are included work (no credits) and ride the background "ai"
// lane, so warming never crowds out what the person is doing.

import { readBrandPayload, studioApi } from "./client";
import type { StudioType } from "./formats";
import type { StudioIdea } from "./ideas";
import { readSkippedIdeas } from "./idea-deck";

/** A batch younger than this is not asked for again. */
const FRESH_MS = 10 * 60_000;
/** A stored batch older than this is not shown at all. */
const KEEP_MS = 3 * 24 * 60 * 60_000;
const STORE_PREFIX = "mellox:idea-batch:";

type Entry = { at: number; ideas?: StudioIdea[]; promise?: Promise<StudioIdea[]> };
const entries = new Map<string, Entry>();

const keyFor = (workspaceId: string, type?: StudioType) => `${workspaceId}|${type ?? ""}`;

function readStored(key: string): Entry | null {
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + key);
    if (!raw) return null;
    const value = JSON.parse(raw) as { at?: unknown; ideas?: unknown };
    if (typeof value.at !== "number" || !Array.isArray(value.ideas)) return null;
    if (Date.now() - value.at > KEEP_MS) return null;
    return { at: value.at, ideas: value.ideas as StudioIdea[] };
  } catch {
    return null;
  }
}

function writeStored(key: string, at: number, ideas: StudioIdea[]) {
  try {
    window.localStorage.setItem(STORE_PREFIX + key, JSON.stringify({ at, ideas }));
  } catch {
    // Storage full or blocked: the in-memory copy still works.
  }
}

function entryFor(key: string): Entry | undefined {
  const e = entries.get(key);
  if (e?.ideas || e?.promise || typeof window === "undefined") return e;
  const stored = readStored(key);
  if (stored) entries.set(key, stored);
  return stored ?? e;
}

function request(workspaceId: string, type: StudioType | undefined, refresh: boolean) {
  return studioApi
    .ideas({
      workspaceId,
      type,
      brand: readBrandPayload(workspaceId),
      dismissed: readSkippedIdeas(workspaceId)
        .map((d) => d.title)
        .slice(-30),
      refresh,
      limit: 8,
    })
    .then((r) => r.ideas);
}

/** The batch in hand (fresh or stored), with whether it is still fresh. */
export function cachedIdeas(
  workspaceId: string,
  type?: StudioType,
): { ideas: StudioIdea[]; fresh: boolean } | null {
  const e = entryFor(keyFor(workspaceId, type));
  if (!e?.ideas?.length) return null;
  return { ideas: e.ideas, fresh: Date.now() - e.at < FRESH_MS };
}

/**
 * Ideas for this workspace and format: a fresh batch if there is one, the
 * request already on its way if one is, else a new request. `refresh` always
 * asks for a new batch (a person pressed "More ideas").
 */
export function loadIdeas(
  workspaceId: string,
  type?: StudioType,
  opts: { refresh?: boolean } = {},
): Promise<StudioIdea[]> {
  const key = keyFor(workspaceId, type);
  const e = entryFor(key);
  if (!opts.refresh) {
    if (e?.ideas?.length && Date.now() - e.at < FRESH_MS) return Promise.resolve(e.ideas);
    if (e?.promise) return e.promise;
  }
  const promise: Promise<StudioIdea[]> = request(workspaceId, type, !!opts.refresh).then(
    (ideas) => {
      const at = Date.now();
      // An empty answer never replaces a batch someone could still swipe.
      if (ideas.length) {
        entries.set(key, { at, ideas });
        writeStored(key, at, ideas);
      } else {
        const current = entries.get(key);
        if (current?.promise === promise)
          entries.set(key, { at: current.at, ideas: current.ideas });
      }
      return ideas;
    },
    (err) => {
      const current = entries.get(key);
      if (current?.promise === promise) entries.set(key, { at: current.at, ideas: current.ideas });
      throw err;
    },
  );
  entries.set(key, { at: e?.at ?? 0, ideas: e?.ideas, promise });
  return promise;
}

/** Warm the cache; never throws, never shows anything. */
export function prefetchIdeas(workspaceId: string, type?: StudioType) {
  if (typeof window === "undefined") return;
  const e = entryFor(keyFor(workspaceId, type));
  if (e?.promise || (e?.ideas?.length && Date.now() - e.at < FRESH_MS)) return;
  void loadIdeas(workspaceId, type).catch(() => {});
}

/** Warm the cache once the browser has nothing else to do. Returns a cancel. */
export function prefetchIdeasWhenIdle(workspaceId: string, type?: StudioType): () => void {
  if (typeof window === "undefined") return () => {};
  const run = () => prefetchIdeas(workspaceId, type);
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  let idle: number | undefined;
  // Let the page draw and its own data load first.
  const t = window.setTimeout(() => {
    if (w.requestIdleCallback) idle = w.requestIdleCallback(run, { timeout: 4000 });
    else run();
  }, 2500);
  return () => {
    window.clearTimeout(t);
    if (idle !== undefined) w.cancelIdleCallback?.(idle);
  };
}
