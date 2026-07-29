// Lightweight client-side queue for in-flight content generations.
// Surfaces NotebookLM-style "being created" rows in the approvals section
// until the real content_items row appears.

import type { CanvasType } from "@/lib/studio";

// Phases map 1:1 to real generation events. The UI never advances past the
// phase the producer has actually reached.
export type GenPhase = "brand-dna" | "research" | "drafting" | "polishing" | "ready";

export const PHASE_ORDER: GenPhase[] = ["brand-dna", "research", "drafting", "polishing", "ready"];

export function phaseIndex(p: GenPhase): number {
  const i = PHASE_ORDER.indexOf(p);
  return i < 0 ? 0 : i;
}

export type GenJob = {
  id: string;
  label: string;
  canvas: CanvasType;
  channel?: string;
  startedAt: number;
  phase: GenPhase;
  phaseAt: number;
};

const EVT = "gen:queue:changed";
const jobs = new Map<string, GenJob>();

function emit() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVT));
}

export const genQueue = {
  enqueue(job: Omit<GenJob, "startedAt" | "phase" | "phaseAt"> & { phase?: GenPhase }) {
    const now = Date.now();
    jobs.set(job.id, {
      ...job,
      startedAt: now,
      phase: job.phase ?? "brand-dna",
      phaseAt: now,
    });
    emit();
  },
  update(id: string, patch: Partial<Omit<GenJob, "id" | "startedAt" | "phaseAt">>) {
    const cur = jobs.get(id);
    if (!cur) return;
    const next: GenJob = { ...cur, ...patch };
    if (patch.phase && patch.phase !== cur.phase) next.phaseAt = Date.now();
    jobs.set(id, next);
    emit();
  },
  advance(id: string, phase: GenPhase) {
    const cur = jobs.get(id);
    if (!cur) return;
    // Never go backwards.
    if (phaseIndex(phase) <= phaseIndex(cur.phase)) return;
    jobs.set(id, { ...cur, phase, phaseAt: Date.now() });
    emit();
  },
  complete(id: string) {
    if (!jobs.delete(id)) return;
    emit();
  },
  list(): GenJob[] {
    return Array.from(jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
  },
  subscribe(cb: () => void): () => void {
    if (typeof window === "undefined") return () => {};
    window.addEventListener(EVT, cb);
    return () => window.removeEventListener(EVT, cb);
  },
};

export function newJobId() {
  return `gen-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}