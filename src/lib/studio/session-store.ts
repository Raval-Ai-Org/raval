"use client";

// Studio session store — the client source of truth for everything being
// created. A session is one piece of work moving through
// intent → generating → review. Sessions persist across navigation and reload
// (localStorage), a single poller advances every active job, and the composer,
// minimized dock, and rail all read from here, so minimizing or closing the
// composer never loses work.
import { useSyncExternalStore } from "react";
import { toast } from "sonner";
import { emitAppEvent } from "@/lib/app-events";
import { getActiveWorkspaceId } from "@/lib/authed-fetch";
import type { PlatformId } from "@/lib/social-platforms";
import { recommendedRatio } from "./aspect";
import { studioApi, readBrandPayload, StudioApiError } from "./client";
import { STUDIO_FORMATS, type StudioType } from "./formats";
import {
  isActiveJob,
  newIdempotencyKey,
  type GoalId,
  type StudioControls,
  type StudioJob,
  type StudioRefine,
} from "./jobs";

export type ComposerWindow = "open" | "maximized" | "minimized";
/** start → pick a format (or an idea); intent → brief + settings; then generate → review. */
export type SessionStep = "start" | "intent" | "generating" | "review";

export type StudioSession = {
  id: string;
  workspaceId: string;
  type: StudioType;
  step: SessionStep;
  brief: string;
  goal?: GoalId;
  ideaId?: string;
  ideaSource?: string;
  controls: StudioControls;
  /** Current job (latest generate / regenerate / refine). */
  job: StudioJob | null;
  /** Last job that succeeded — what review shows while a revision runs. */
  lastGood: StudioJob | null;
  /** Idempotency key of a create request that hasn't returned yet. */
  pendingKey: string | null;
  pendingKind: "generate" | "regenerate" | "refine" | null;
  error: string | null;
  window: ComposerWindow;
  createdAt: number;
  updatedAt: number;
};

type State = {
  sessions: StudioSession[];
  activeId: string | null;
  /** Recent jobs for the workspace (rail "In progress"). */
  jobs: StudioJob[];
};

const STORAGE_KEY = "studio:sessions:v2";
const MAX_SESSIONS = 8;

let state: State = { sessions: [], activeId: null, jobs: [] };
const listeners = new Set<() => void>();
let hydrated = false;

function emit() {
  for (const l of listeners) l();
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    const sessions = state.sessions.slice(0, MAX_SESSIONS).map((s) => ({
      ...s,
      // Signed URLs expire; they're refreshed from the server on resume.
      job: s.job ? stripUrls(s.job) : null,
      lastGood: s.lastGood ? stripUrls(s.lastGood) : null,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions, activeId: state.activeId }));
  } catch {
    /* quota — sessions still live in memory */
  }
}

function stripUrls(job: StudioJob): StudioJob {
  if (!job.output?.media?.length) return job;
  return {
    ...job,
    output: { ...job.output, media: job.output.media.map(({ url: _u, ...m }) => m) },
  };
}

function setState(next: Partial<State>, save = true) {
  state = { ...state, ...next };
  if (save) persist();
  emit();
  schedulePoll();
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { sessions?: StudioSession[]; activeId?: string | null };
      const sessions = (parsed.sessions ?? []).filter((s) => s && s.id && STUDIO_FORMATS[s.type]);
      // A reload never reopens a composer over the page; active work shows in the dock.
      state = {
        ...state,
        sessions: sessions.map((s) => ({
          ...s,
          window: s.window === "minimized" ? "minimized" : "minimized",
        })),
        activeId: null,
      };
    }
  } catch {
    /* ignore */
  }
  schedulePoll();
}

export function subscribe(listener: () => void) {
  hydrate();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot: State = { sessions: [], activeId: null, jobs: [] };

export function useStudioStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(serverSnapshot),
  );
}

export function getStudioState(): State {
  hydrate();
  return state;
}

/* ───────────────────────── session actions ───────────────────────── */

function defaultControls(type: StudioType, platforms?: PlatformId[]): StudioControls {
  const format = STUDIO_FORMATS[type];
  const picked = (platforms ?? []).filter((p) => format.platforms.includes(p));
  const chosen = picked.length ? picked : format.defaultPlatforms;
  const controls: StudioControls = {
    platforms: format.multiPlatform ? chosen : chosen.slice(0, 1),
  };
  if (format.ratios.length) {
    controls.ratio =
      type === "carousel"
        ? "4:5"
        : recommendedRatio(controls.platforms, type === "video" ? "video" : "image", format.ratios);
  }
  if (type === "carousel") controls.slideCount = 6;
  if (type === "article") controls.length = "standard";
  if (type === "script") controls.durationSec = 30;
  if (type === "video")
    Object.assign(controls, { durationSec: 6, videoResolution: "720P", audio: true });
  return controls;
}

function patchSession(
  id: string,
  patch: Partial<StudioSession> | ((s: StudioSession) => Partial<StudioSession>),
) {
  const sessions = state.sessions.map((s) =>
    s.id === id
      ? { ...s, ...(typeof patch === "function" ? patch(s) : patch), updatedAt: Date.now() }
      : s,
  );
  setState({ sessions });
}

export function getSession(id: string | null): StudioSession | null {
  return state.sessions.find((s) => s.id === id) ?? null;
}

export function openComposer(
  opts: {
    type?: StudioType;
    brief?: string;
    goal?: GoalId;
    ideaId?: string;
    ideaSource?: string;
    platforms?: PlatformId[];
  } = {},
): string | null {
  hydrate();
  const workspaceId = getActiveWorkspaceId();
  if (!workspaceId) {
    toast.error("Choose a workspace first", {
      description: "Studio creates content for one brand at a time.",
    });
    return null;
  }
  // Without a format (⌘J, the rail's Create button) Studio opens on the start
  // screen so the choice of format and idea comes first.
  const type = opts.type ?? "social";
  const step: SessionStep = opts.type || opts.brief ? "intent" : "start";

  // Reuse an untouched session instead of stacking empty ones.
  const reusable = state.sessions.find(
    (s) =>
      s.workspaceId === workspaceId &&
      (step === "start" ? s.step === "start" : s.type === type && s.step === "intent") &&
      !s.brief.trim() &&
      !s.job,
  );
  const now = Date.now();
  const session: StudioSession = reusable
    ? {
        ...reusable,
        brief: opts.brief ?? reusable.brief,
        goal: opts.goal ?? reusable.goal,
        ideaId: opts.ideaId,
        ideaSource: opts.ideaSource,
        controls: opts.platforms ? defaultControls(type, opts.platforms) : reusable.controls,
        step,
        window: "open",
        updatedAt: now,
      }
    : {
        id: `s-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        workspaceId,
        type,
        step,
        brief: opts.brief ?? "",
        goal: opts.goal,
        ideaId: opts.ideaId,
        ideaSource: opts.ideaSource,
        controls: defaultControls(type, opts.platforms),
        job: null,
        lastGood: null,
        pendingKey: null,
        pendingKind: null,
        error: null,
        window: "open",
        createdAt: now,
        updatedAt: now,
      };
  const others = state.sessions
    .filter((s) => s.id !== session.id)
    .map((s) => (s.window === "minimized" ? s : { ...s, window: "minimized" as const }));
  setState({ sessions: [session, ...others].slice(0, MAX_SESSIONS), activeId: session.id });
  return session.id;
}

/** Open review for an existing job (from the rail, a deep link, or a notification). */
export async function openJob(jobId: string, workspaceId?: string | null): Promise<string | null> {
  hydrate();
  const ws = workspaceId ?? getActiveWorkspaceId();
  if (!ws) return null;
  const existing = state.sessions.find((s) => s.job?.id === jobId || s.lastGood?.id === jobId);
  if (existing) {
    focusSession(existing.id);
    void refreshSessionJob(existing.id);
    return existing.id;
  }
  try {
    const job = await studioApi.getJob(ws, jobId);
    const now = Date.now();
    const session: StudioSession = {
      id: `s-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      workspaceId: ws,
      type: job.type,
      step: isActiveJob(job)
        ? "generating"
        : job.status === "succeeded"
          ? "review"
          : job.parent_job_id
            ? "review"
            : "intent",
      brief: job.input?.intent?.brief ?? "",
      goal: job.input?.intent?.goal,
      controls: job.input?.controls ?? defaultControls(job.type),
      job,
      lastGood: job.status === "succeeded" ? job : null,
      pendingKey: null,
      pendingKind: null,
      error: job.status === "failed" ? (job.error?.message ?? "Generation failed") : null,
      window: "open",
      createdAt: now,
      updatedAt: now,
    };
    const others = state.sessions.map((s) =>
      s.window === "minimized" ? s : { ...s, window: "minimized" as const },
    );
    setState({ sessions: [session, ...others].slice(0, MAX_SESSIONS), activeId: session.id });
    return session.id;
  } catch (error) {
    toast.error("Couldn't open this draft", {
      description: error instanceof Error ? error.message : undefined,
    });
    return null;
  }
}

export function updateSession(
  id: string,
  patch: Partial<
    Pick<StudioSession, "brief" | "goal" | "ideaId" | "ideaSource" | "controls" | "type" | "error">
  >,
) {
  patchSession(id, (s) => {
    if (patch.type && patch.type !== s.type) {
      return {
        ...patch,
        controls: defaultControls(patch.type, s.controls.platforms),
        ideaId: undefined,
        ideaSource: undefined,
      };
    }
    return patch;
  });
}

export function focusSession(id: string) {
  const sessions = state.sessions.map((s) =>
    s.id === id
      ? { ...s, window: s.window === "maximized" ? "maximized" : ("open" as ComposerWindow) }
      : s.window === "minimized"
        ? s
        : { ...s, window: "minimized" as const },
  );
  setState({ sessions, activeId: id });
}

export function minimizeSession(id: string) {
  patchSession(id, { window: "minimized" });
  if (state.activeId === id) setState({ activeId: null });
}

export function toggleMaximize(id: string) {
  patchSession(id, (s) => ({ window: s.window === "maximized" ? "open" : "maximized" }));
}

/**
 * Close the composer. Anything still generating, or a brief the user typed
 * but hasn't generated, moves to the dock; finished work is already safe in
 * Needs Approval, so its session simply ends.
 */
export function closeSession(id: string) {
  const s = getSession(id);
  if (!s) return;
  const keep =
    s.pendingKey ||
    (s.job && isActiveJob(s.job)) ||
    (s.step === "intent" && s.brief.trim().length > 0 && !s.lastGood);
  if (keep) {
    minimizeSession(id);
    return;
  }
  setState({
    sessions: state.sessions.filter((x) => x.id !== id),
    activeId: state.activeId === id ? null : state.activeId,
  });
}

/** Remove a session entirely (after cancel, or dismissing a finished one). */
export function discardSession(id: string) {
  setState({
    sessions: state.sessions.filter((x) => x.id !== id),
    activeId: state.activeId === id ? null : state.activeId,
  });
}

/** Apply local edits that were saved to the content rows. */
export function patchJobOutput(id: string, output: StudioJob["output"], title?: string) {
  patchSession(id, (s) => {
    const base = s.lastGood ?? s.job;
    if (!base) return {};
    const next = { ...base, output, title: title ?? base.title };
    return { lastGood: next, job: s.job?.id === base.id ? next : s.job };
  });
}

/** Start screen → brief: settle the format (resetting format-specific settings). */
export function chooseType(
  id: string,
  type: StudioType,
  seed: {
    brief?: string;
    goal?: GoalId;
    ideaId?: string;
    ideaSource?: string;
    platforms?: PlatformId[];
  } = {},
) {
  patchSession(id, (s) => ({
    type,
    step: "intent",
    controls: defaultControls(
      type,
      seed.platforms ?? (s.type === type ? s.controls.platforms : undefined),
    ),
    brief: seed.brief ?? s.brief,
    goal: seed.goal ?? s.goal,
    ideaId: seed.ideaId,
    ideaSource: seed.ideaSource,
    error: null,
  }));
}

/** Brief → start screen, to pick a different format. */
export function backToStart(id: string) {
  patchSession(id, (s) => (s.job || s.lastGood ? {} : { step: "start", error: null }));
}

export function backToBrief(id: string) {
  patchSession(id, { step: "intent", error: null });
}

/* ───────────────────────── generation ───────────────────────── */

export async function generate(
  id: string,
  opts: { kind?: "generate" | "regenerate" | "refine"; refine?: StudioRefine } = {},
) {
  const s = getSession(id);
  if (!s) return;
  if (s.pendingKey || (s.job && isActiveJob(s.job))) return; // never double-submit
  const kind = opts.kind ?? "generate";
  const brief = s.brief.trim();
  if (brief.length < 3) {
    patchSession(id, { error: "Tell Mellox what this should achieve first." });
    return;
  }
  const parent = kind === "generate" ? null : (s.lastGood ?? s.job);
  const key = newIdempotencyKey();
  patchSession(id, {
    pendingKey: key,
    pendingKind: kind,
    step: kind === "generate" ? "generating" : s.step === "intent" ? "generating" : s.step,
    error: null,
  });
  await submit(id, key, kind, parent?.id, opts.refine);
}

async function submit(
  id: string,
  key: string,
  kind: StudioSession["pendingKind"],
  parentJobId?: string,
  refine?: StudioRefine,
) {
  const s = getSession(id);
  if (!s) return;
  try {
    const job = await studioApi.createJob({
      workspaceId: s.workspaceId,
      type: s.type,
      idempotencyKey: key,
      intent: { brief: s.brief.trim(), goal: s.goal, ideaId: s.ideaId, ideaSource: s.ideaSource },
      controls: s.controls,
      brand: readBrandPayload(s.workspaceId),
      parentJobId,
      refine,
      regenerate: kind === "regenerate",
    });
    applyJob(id, job, { fromCreate: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    const current = getSession(id);
    if (!current || current.pendingKey !== key) return;
    patchSession(id, {
      pendingKey: null,
      pendingKind: null,
      step: current.lastGood ? "review" : "intent",
      error: message,
    });
    if (error instanceof StudioApiError && error.status === 409) void refreshSessionJob(id);
  } finally {
    upsertJobs([]);
  }
}

function applyJob(sessionId: string, job: StudioJob, opts: { fromCreate?: boolean } = {}) {
  const s = getSession(sessionId);
  if (!s) return;
  const wasActive = !!(s.job && isActiveJob(s.job)) || !!s.pendingKey;
  const active = isActiveJob(job);
  const patch: Partial<StudioSession> = {
    job,
    pendingKey: opts.fromCreate || !active ? null : s.pendingKey,
    pendingKind: active ? s.pendingKind : null,
  };
  if (active) {
    patch.step = s.lastGood && s.step === "review" ? "review" : "generating";
  } else if (job.status === "succeeded") {
    patch.step = "review";
    patch.lastGood = job;
    patch.error = null;
  } else if (job.status === "failed") {
    patch.step = s.lastGood ? "review" : "intent";
    patch.error = job.error?.message ?? "Generation failed";
  } else if (job.status === "cancelled") {
    patch.step = s.lastGood ? "review" : "intent";
  }
  patchSession(sessionId, patch);
  upsertJobs([job]);

  if (wasActive && !active) {
    emitAppEvent("content:changed");
    const format = STUDIO_FORMATS[job.type];
    const minimized = getSession(sessionId)?.window === "minimized";
    if (job.status === "succeeded" && minimized) {
      toast.success(`Your ${format.noun} is ready`, {
        description: "It's waiting in Needs Approval.",
        action: { label: "Review", onClick: () => focusSession(sessionId) },
      });
    } else if (job.status === "failed" && minimized) {
      toast.error(`Your ${format.noun} couldn't be finished`, {
        description: job.error?.message,
        action: { label: "Open", onClick: () => focusSession(sessionId) },
      });
    }
  }
}

export async function cancelSession(id: string) {
  const s = getSession(id);
  if (!s) return;
  const job = s.job && isActiveJob(s.job) ? s.job : null;
  if (!job && s.pendingKey) {
    // The create request is still running; find its job and cancel that.
    try {
      const jobs = await studioApi.listJobs(s.workspaceId);
      const match = jobs.find((j) => j.idempotency_key === s.pendingKey);
      if (match) {
        const cancelled = await studioApi.cancelJob(s.workspaceId, match.id);
        patchSession(id, { pendingKey: null, pendingKind: null });
        applyJob(id, cancelled);
      } else {
        patchSession(id, {
          pendingKey: null,
          pendingKind: null,
          step: s.lastGood ? "review" : "intent",
        });
      }
    } catch (error) {
      toast.error("Couldn't cancel", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
    return;
  }
  if (!job) return;
  try {
    const cancelled = await studioApi.cancelJob(s.workspaceId, job.id);
    applyJob(id, cancelled);
    toast("Generation stopped", {
      description: s.lastGood ? "Your previous version is unchanged." : "Nothing was saved.",
    });
  } catch (error) {
    toast.error("Couldn't cancel", {
      description: error instanceof Error ? error.message : undefined,
    });
  }
}

export async function refreshSessionJob(id: string) {
  const s = getSession(id);
  const jobId = s?.job?.id;
  if (!s || !jobId) return;
  try {
    applyJob(id, await studioApi.getJob(s.workspaceId, jobId));
  } catch {
    /* transient */
  }
}

/** Keep the rail's job list current. */
function upsertJobs(jobs: StudioJob[]) {
  if (!jobs.length) return;
  const byId = new Map(state.jobs.map((j) => [j.id, j]));
  for (const j of jobs) byId.set(j.id, j);
  const merged = [...byId.values()]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 25);
  setState({ jobs: merged }, false);
}

export async function refreshWorkspaceJobs(workspaceId?: string | null) {
  const ws = workspaceId ?? getActiveWorkspaceId();
  if (!ws) return;
  try {
    const jobs = await studioApi.listJobs(ws);
    setState({ jobs }, false);
    // Adopt server progress into sessions whose create request is still open.
    for (const s of state.sessions) {
      if (s.workspaceId !== ws) continue;
      const match = s.pendingKey ? jobs.find((j) => j.idempotency_key === s.pendingKey) : null;
      if (match && (!s.job || s.job.id !== match.id)) {
        patchSession(s.id, { job: match, step: s.step === "intent" ? "generating" : s.step });
      }
    }
  } catch {
    /* transient */
  }
}

/* ───────────────────────── poller ───────────────────────── */

let pollTimer: number | null = null;
let polling = false;

function needsPolling(): boolean {
  return (
    state.sessions.some((s) => s.pendingKey || (s.job && isActiveJob(s.job))) ||
    state.jobs.some((j) => isActiveJob(j))
  );
}

function schedulePoll() {
  if (typeof window === "undefined" || pollTimer !== null || !needsPolling()) return;
  const hidden = document.visibilityState === "hidden";
  pollTimer = window.setTimeout(
    () => {
      pollTimer = null;
      void pollOnce();
    },
    hidden ? 8000 : 2000,
  );
}

async function pollOnce() {
  if (polling) return;
  polling = true;
  try {
    const ws = getActiveWorkspaceId();
    // Sessions with a create still in flight: read progress from the list.
    if (state.sessions.some((s) => s.pendingKey && !s.job)) await refreshWorkspaceJobs(ws);

    const tracked = new Set<string>();
    for (const s of state.sessions) {
      const job = s.job;
      if (!job || !isActiveJob(job) || s.pendingKey) continue;
      tracked.add(job.id);
      try {
        applyJob(s.id, await studioApi.getJob(s.workspaceId, job.id));
      } catch (error) {
        if (error instanceof StudioApiError && error.status === 404) {
          patchSession(s.id, { job: null, step: s.lastGood ? "review" : "intent" });
        }
      }
    }
    // Background jobs (another tab, or a closed session): advance them too so
    // renders finish even when no composer is watching.
    if (ws) {
      for (const job of state.jobs.filter(
        (j) => isActiveJob(j) && !tracked.has(j.id) && j.workspace_id === ws,
      )) {
        const pendingCreate = state.sessions.some((s) => s.pendingKey === job.idempotency_key);
        if (pendingCreate && job.stage !== "render" && job.stage !== "save") continue;
        try {
          const next = await studioApi.getJob(ws, job.id);
          upsertJobs([next]);
          if (!isActiveJob(next)) emitAppEvent("content:changed");
        } catch {
          /* transient */
        }
      }
    }
  } finally {
    polling = false;
    schedulePoll();
  }
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && pollTimer !== null) {
      window.clearTimeout(pollTimer);
      pollTimer = null;
      void pollOnce();
    }
  });
}
