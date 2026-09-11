// app-events.ts — the typed registry for cross-component window events.
//
// Modules that don't share a React tree (the chat shell, Studio, modals opened
// from the AI's action tags) talk through `window` CustomEvents. Before this
// file those were bare strings: a dispatch nobody listened to, or a listener
// for a name nobody dispatched, compiled fine and failed silently in the UI.
// Every event is now declared once in AppEventMap with its payload, and the
// helpers below only accept declared names — so a typo or a payload mismatch
// is a type error. ESLint forbids `new CustomEvent(` outside this file.
//
// Still plain window events underneath: listeners registered with
// addEventListener elsewhere keep working, and nothing here is React-specific
// except `useAppEvent`.
import { useEffect, useRef } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { PreviewContext, PreviewStageEvent } from "@/lib/preview-stages";

type RowChange = RealtimePostgresChangesPayload<Record<string, unknown>>;

export type AppEventMap = {
  // ── Data changed — listeners refetch ────────────────────────────────
  /** Content items changed (a local mutation, or a realtime row change). */
  "content:changed": RowChange | undefined;
  "approvals:changed": RowChange | undefined;
  /** The selected workspace changed; `id: null` on sign-out. */
  "workspace:changed": { id: string | null } | undefined;
  "brand-dna:saved": undefined;
  "notes:changed": { workspaceId: string };
  "assets:changed": undefined;
  "connections:changed": undefined;
  "post-image:cached": { postId: string; size?: string; removed?: boolean };
  "geo:audit-complete": undefined;
  "gen:queue:changed": undefined;

  // ── Chat ────────────────────────────────────────────────────────────
  /** Put text in the chat composer; `focus` defaults to true. */
  "chat:prefill": string | { text: string; focus?: boolean };
  "chat:focus": undefined;
  "chat:working": { label?: string; hue?: number } | undefined;
  "chat:idle": undefined;
  "chat:conversation-changed": undefined;

  // ── Live preview stage strip ─────────────────────────────────────────
  "preview:stage": PreviewStageEvent;
  "preview:idle": undefined;
  "preview:context": PreviewContext;

  // ── Commands ────────────────────────────────────────────────────────
  "geo:run-audit": undefined;

  // ── Open / toggle surfaces ──────────────────────────────────────────
  "open:analytics": { tab?: string } | undefined;
  "open:brand-dna": { tab?: string } | undefined;
  /** Open a Studio canvas. `type` is validated by the listener (use-studio). */
  "open:canvas":
    { type?: string; id?: string; mode?: "draft" | "review" | "view"; brief?: string } | undefined;
  "open:ai-visibility": undefined;
  "open:autopilot": undefined;
  "open:client-portal": undefined;
  "open:command-bar": undefined;
  "open:competitor-watch": undefined;
  "open:connectors": undefined;
  "open:content-calendar": undefined;
  "open:details": undefined;
  "open:marketing-coach": undefined;
  "open:publish": undefined;
  "open:rename": undefined;
  "open:schedule": undefined;
  "open:settings": undefined;
  "open:share": undefined;
  "open:studio": undefined;
  "open:tasks": undefined;
  /** No billing surface listens yet — see docs/adr/0006. */
  "open:upgrade": undefined;
  "toggle:ai-visibility": undefined;
  "toggle:studio": undefined;
};

export type AppEventName = keyof AppEventMap;
// Per the DOM spec an omitted CustomEvent detail arrives as `null`, so
// optional payloads are `T | null` on the listening side.
type ReceivedDetail<K extends AppEventName> = undefined extends AppEventMap[K]
  ? Exclude<AppEventMap[K], undefined> | null
  : AppEventMap[K];
export type AppEvent<K extends AppEventName> = CustomEvent<ReceivedDetail<K>>;
export type AppEventHandler<K extends AppEventName> = (event: AppEvent<K>) => void;

// Events whose payload may be omitted take an optional detail argument.
type DetailArgs<K extends AppEventName> = undefined extends AppEventMap[K]
  ? [detail?: AppEventMap[K]]
  : [detail: AppEventMap[K]];

export function emitAppEvent<K extends AppEventName>(name: K, ...args: DetailArgs<K>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail: args[0] }));
}

export function addAppEventListener<K extends AppEventName>(
  name: K,
  handler: AppEventHandler<K>,
): void {
  window.addEventListener(name, handler as EventListener);
}

export function removeAppEventListener<K extends AppEventName>(
  name: K,
  handler: AppEventHandler<K>,
): void {
  window.removeEventListener(name, handler as EventListener);
}

/** Subscribe outside React; returns the unsubscribe function. */
export function onAppEvent<K extends AppEventName>(
  name: K,
  handler: AppEventHandler<K>,
): () => void {
  if (typeof window === "undefined") return () => {};
  addAppEventListener(name, handler);
  return () => removeAppEventListener(name, handler);
}

/**
 * Subscribe for the component's lifetime. The latest handler is always
 * called, so it can close over fresh state without re-subscribing.
 */
export function useAppEvent<K extends AppEventName>(name: K, handler: AppEventHandler<K>): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => onAppEvent(name, (event) => ref.current(event)), [name]);
}
