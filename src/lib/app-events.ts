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
// addEventListener elsewhere keep working. This module has no React
// dependency (see `use-app-event.ts` for the hook) so it's safe to import
// from server code — every function here is a no-op off the client.
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
  /** Open the Operations inbox (agent findings, runs, approvals). */
  "open:operations": { tab?: "findings" | "approvals" | "runs" } | undefined;
  /** Open Plan & billing, optionally on a tab. */
  "open:usage": { tab?: "overview" | "plans" | "topup" | "prices" | "history" } | undefined;
  "billing:changed": { balance?: number } | undefined;
  /** What the thing being set up will cost (the sidebar gauge shows it); null clears it. */
  "credits:preview": { credits?: number; videoUnits?: number; label: string } | null | undefined;
  "billing:blocked": {
    code: string;
    feature?: string;
    requiredPlan?: string;
    meter?: string;
    needed?: number;
    available?: number;
    limit?: string;
    used?: number;
    max?: number;
  };
  "brand-dna:saved": undefined;
  /** This person has looked at the Brain updates (every "new" count resets). */
  "brain:seen": { workspaceId: string; at: number };
  "notes:changed": { workspaceId: string };
  /** The brand's memory changed (chat saved, updated or removed something). */
  "memory:changed": { workspaceId: string };
  "assets:changed": undefined;
  "connections:changed": undefined;
  "post-image:cached": { postId: string; size?: string; removed?: boolean };
  "geo:audit-complete": undefined;
  /** Analytics data or insights changed (sync finished, insight refreshed, Google connected). */
  "analytics:changed": undefined;
  "gen:queue:changed": undefined;

  // ── Shell ───────────────────────────────────────────────────────────
  /** A full window opened or closed; the sidebar highlights its row (nav.ts id). */
  "shell:window": { id: string; open: boolean };
  /** A sidebar row was pressed: every window on the canvas steps aside for it. */
  "shell:leave": undefined;
  /**
   * Background work that isn't a Studio piece (a strategy, a campaign plan…)
   * shows in the corner list (GeneratingPanel) instead of a pop-up. Send the
   * same id again with the new state; `href` is where a press on the row goes,
   * `ugcProjectId` opens that Creator video instead.
   */
  "work:update": {
    id: string;
    title: string;
    state: "working" | "done" | "failed";
    step?: string;
    doneLabel?: string;
    href?: string;
    ugcProjectId?: string;
  };
  /** "Run in background" on a Creator video: its window steps aside, the render goes on. */
  "ugc:minimize": undefined;

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
  /**
   * Open Brain (ADR-0032): the four brains and the strategy, optionally on a
   * section and a place inside it. Only ever fired by a button.
   */
  "open:brain":
    | {
        section?: "home" | "brand" | "audience" | "competitors" | "market" | "strategy";
        tab?: string;
      }
    | undefined;
  /** Opens Brain → Brand, optionally on one editor ("colors"…). "look" / "assets" open Inspo. */
  "open:brand-dna": { tab?: string } | undefined;
  /**
   * Navigates to Inspo (ADR-0037) at /w/<id>/app/inspo, optionally on a
   * section (board, post, video, voice, media). Only ever fired by a button.
   */
  "open:inspo": { section?: string } | undefined;
  /** Open a Studio canvas. `type` is validated by the listener (use-studio). */
  "open:canvas":
    | {
        type?: string;
        id?: string;
        mode?: "draft" | "review" | "view";
        brief?: string;
        goal?: string;
        ideaId?: string;
        ideaSource?: string;
        platforms?: string[];
        /** The brand's own photos (asset ids, checked again on the server). */
        referenceAssetIds?: string[];
        referenceMode?: "preserve" | "design" | "edit" | "inspire";
        /** The brand's own clips, for "Brand my clips". */
        sourceVideoAssetIds?: string[];
        videoMode?: "generate" | "brand" | "recap";
      }
    | undefined;
  /** Review a single content item outside a Studio job (legacy or chat-created). */
  "open:content-item": { id: string };
  /** Open the Library pop-up, optionally on a tab. */
  "open:library":
    | {
        tab?: "all" | "posts" | "media" | "loved";
        /** Preselect a pipeline stage filter. */
        status?: "review" | "ready" | "scheduled" | "published" | "scheduled-published";
      }
    | undefined;
  "open:ai-visibility": undefined;
  /** UGC Video Ads studio, optionally on one ad project. */
  "open:ugc-studio":
    | {
        projectId?: string;
        source?: import("@/lib/studio/script-video").ScriptVideoSource;
        /** Opened from Create: its Back returns there. */
        fromCreate?: boolean;
      }
    | undefined;
  /**
   * The "Create" launcher: pick a starting point, then a format. `back` is the
   * place a Back press came from (a Studio session id, "animate", "ugc"), so
   * Create reopens on the list that place was picked from.
   */
  "open:create-launcher": { back?: string } | undefined;
  /** Home → Animate: pick a Library picture and a way to move it. */
  "open:animate": { fromCreate?: boolean } | undefined;
  "open:client-portal": undefined;
  "open:command-bar": undefined;
  /** Opens Brain → Competitors. */
  "open:competitors": undefined;
  /** Navigates to Autopilot at /w/<id>/app/autopilot. Only ever fired by a button. */
  "open:autopilot": undefined;
  /** Opens Brain → Audience. Only ever fired by a button. */
  "open:audience": undefined;
  "open:content-calendar": undefined;
  /**
   * Navigates to Campaigns (ADR-0039) at /w/<id>/app/campaigns, optionally on
   * one campaign or the designer for a kind. Only ever fired by a button.
   */
  "open:campaigns": { campaignId?: string; type?: string } | undefined;
  "open:details": undefined;
  /** Opens Brain → Home → Today (the day's plan). */
  "open:marketing-coach": undefined;
  "open:publish": undefined;
  "open:rename": undefined;
  "open:schedule": undefined;
  /** The "Start here" checklist (Mellox 2.0), from the top bar or after onboarding. */
  "open:start-here": undefined;
  /**
   * Settings, optionally on a section. "analytics" and "website" are older
   * names: both open Connectors (on Google Analytics / the website connectors).
   * `connector` opens one connector in the gallery (`canva`, `googleads`, ...).
   */
  "open:settings":
    | {
        section?:
          | "accounts"
          | "connectors"
          | "analytics"
          | "website"
          | "assistants"
          | "agents"
          | "memory"
          | "language"
          | "preferences";
        connector?: string;
      }
    | undefined;
  /** Navigates to Backlinks at /w/<id>/app/backlinks. Only ever fired by a button. */
  "open:backlinks": undefined;
  /** Navigates to Experiments at /w/<id>/app/experiments. Only ever fired by a button. */
  "open:experiments": undefined;
  "open:share": undefined;
  "open:studio": undefined;
  "open:tasks": undefined;
  /** Take the app tour again (account menu). Only ever fired by a button. */
  "open:tour": undefined;
  /**
   * Open the upgrade screen. With a block it explains that block (locked
   * feature, empty balance, limit); without one it offers the next plan.
   * Only ever emitted from a person's click.
   */
  "open:upgrade":
    | {
        code: string;
        feature?: string;
        requiredPlan?: string;
        meter?: string;
        needed?: number;
        available?: number;
        limit?: string;
        used?: number;
        max?: number;
      }
    | undefined;
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

const appEventListeners = new Map<AppEventName, Set<EventListener>>();
const pendingOpenEvents = new Map<
  AppEventName,
  { event: CustomEvent<unknown>; workspaceId: string | null }
>();

function activeWorkspaceId(): string | null {
  if (typeof window.location === "undefined") return null;
  return window.location.pathname.match(/^\/w\/([^/]+)\/app(?:\/|$)/)?.[1] ?? null;
}

// Events whose payload may be omitted take an optional detail argument.
type DetailArgs<K extends AppEventName> = undefined extends AppEventMap[K]
  ? [detail?: AppEventMap[K]]
  : [detail: AppEventMap[K]];

export function emitAppEvent<K extends AppEventName>(name: K, ...args: DetailArgs<K>): void {
  if (typeof window === "undefined") return;
  const event = new CustomEvent(name, { detail: args[0] });
  if (name.startsWith("open:") && !appEventListeners.get(name)?.size) {
    pendingOpenEvents.set(name, {
      event: event as CustomEvent<unknown>,
      workspaceId: activeWorkspaceId(),
    });
  }
  if (name === "workspace:changed") {
    const workspaceId = (args[0] as AppEvent<"workspace:changed">["detail"])?.id;
    for (const [pendingName, pending] of pendingOpenEvents) {
      if (!workspaceId || pending.workspaceId !== workspaceId)
        pendingOpenEvents.delete(pendingName);
    }
  }
  window.dispatchEvent(event);
}

export function addAppEventListener<K extends AppEventName>(
  name: K,
  handler: AppEventHandler<K>,
): void {
  const listener = handler as EventListener;
  window.addEventListener(name, listener);
  const listeners = appEventListeners.get(name) ?? new Set<EventListener>();
  listeners.add(listener);
  appEventListeners.set(name, listeners);

  const pending = pendingOpenEvents.get(name);
  if (pending && pending.workspaceId === activeWorkspaceId()) {
    pendingOpenEvents.delete(name);
    window.dispatchEvent(pending.event);
  } else if (pending) {
    pendingOpenEvents.delete(name);
  }
}

export function removeAppEventListener<K extends AppEventName>(
  name: K,
  handler: AppEventHandler<K>,
): void {
  const listener = handler as EventListener;
  window.removeEventListener(name, listener);
  const listeners = appEventListeners.get(name);
  listeners?.delete(listener);
  if (!listeners?.size) appEventListeners.delete(name);
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
