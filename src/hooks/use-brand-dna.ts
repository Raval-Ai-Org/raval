"use client";

import { useEffect, useState } from "react";
import { emitAppEvent } from "@/lib/app-events";
import { buildDesignMd, saveDesignMd } from "@/lib/design-md";

export interface BrandColor {
  name: string;
  hex: string;
}
export interface BrandSocial {
  platform: string;
  url: string;
}
export interface BrandSource {
  label: string;
  snippet?: string;
  url?: string;
}

export type ExtractStatus = "idle" | "loading" | "ok" | "error";

export interface Competitor {
  id: string;
  name: string;
  url?: string;
  positioning?: string;
  strengths?: string;
  weaknesses?: string;
  pricing?: string;
  notes?: string;
}

export interface Persona {
  id: string;
  name: string;
  role?: string;
  segment?: string;
  goals?: string;
  painPoints?: string;
  objections?: string;
  channels?: string;
}

export interface Testimonial {
  id: string;
  quote: string;
  author?: string;
  role?: string;
  source?: string;
}

export interface AssetItem {
  id: string;
  label: string;
  url: string;
  kind?: "logo" | "image" | "doc" | "design" | "video" | "link";
  notes?: string;
}

export interface MemoryNote {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  source?: "user" | "chat" | "manual";
}

export interface SignalEvidence {
  id: string;
  text: string;
  sourceLabel?: string;
  sourceUrl?: string;
  capturedAt?: number;
}

export interface CustomerSignals {
  jobsToBeDone: string;
  painPoints: string;
  objections: string;
  buyingTriggers: string;
  decisionCriteria: string;
  channels: string;
  feedback: string;
  testimonials: Testimonial[];
  personas: Persona[];
  triggerSignals: SignalEvidence[];
  objectionSignals: SignalEvidence[];
  feedbackSources: SignalEvidence[];
}

export interface BrandDna {
  brandName: string;
  oneLiner: string;
  about: string;
  industry: string;
  businessModel: string;
  voice: string;
  audience: string;
  values: string;
  products: string;
  doRules: string;
  dontRules: string;
  audienceTags: string[];
  valueTags: string[];
  colors: BrandColor[];
  fonts: string[];
  logoUrl: string | null;
  faviconUrl: string | null;
  websiteUrl: string | null;
  socials: BrandSocial[];
  missing: string[];
  /** Per-field provenance: where the value came from (e.g. "og:site_name", "theme-color meta", "homepage H1"). */
  sources: Record<string, BrandSource>;
  status: ExtractStatus;
  lastError: string | null;
  extractedAt: number | null;
  updatedAt: number;
  // Extended memory
  competitors: Competitor[];
  customer: CustomerSignals;
  assets: AssetItem[];
  notes: MemoryNote[];
  mission: string;
  vision: string;
  positioning: string;
  uniqueValueProp: string;
  keywords: string[];
  userInsights: MemoryNote[];
  memoryLastMsgCount?: number;
  memoryUpdatedAt?: number;
  /** Newest chat message (ms) already sent for memory extraction, per conversation id or "workspace". */
  memorySyncedAt?: Record<string, number>;
}

export const emptyCustomer: CustomerSignals = {
  jobsToBeDone: "",
  painPoints: "",
  objections: "",
  buyingTriggers: "",
  decisionCriteria: "",
  channels: "",
  feedback: "",
  testimonials: [],
  personas: [],
  triggerSignals: [],
  objectionSignals: [],
  feedbackSources: [],
};

export const emptyDna: BrandDna = {
  brandName: "",
  oneLiner: "",
  about: "",
  industry: "",
  businessModel: "",
  voice: "",
  audience: "",
  values: "",
  products: "",
  doRules: "",
  dontRules: "",
  audienceTags: [],
  valueTags: [],
  colors: [],
  fonts: [],
  logoUrl: null,
  faviconUrl: null,
  websiteUrl: null,
  socials: [],
  missing: [],
  sources: {},
  status: "idle",
  lastError: null,
  extractedAt: null,
  updatedAt: 0,
  competitors: [],
  customer: emptyCustomer,
  assets: [],
  notes: [],
  mission: "",
  vision: "",
  positioning: "",
  uniqueValueProp: "",
  keywords: [],
  userInsights: [],
};

const TEXT_FIELDS: (keyof BrandDna)[] = [
  "brandName",
  "oneLiner",
  "about",
  "industry",
  "businessModel",
  "voice",
  "audience",
  "values",
  "products",
  "doRules",
  "dontRules",
];

// Brand DNA is stored per workspace in the database (workspace_brand_dna,
// src/server/fns/brand-dna.ts). This module keeps one entry PER WORKSPACE ID:
//   - a hook for workspace B never sees workspace A's entry, so switching
//     brands can't carry DNA across (it starts empty until B's loads);
//   - `save` captures the workspace id at call time, and its debounced server
//     write goes to that id even if the user has switched since;
//   - `brand-dna:v3:<id>` in localStorage is only a same-workspace cache for
//     instant render and for synchronous readers (Studio, post images).
// Fields save on every keystroke, so server writes and the `brand-dna:saved`
// announcement are debounced.

const SAVED_SETTLE_MS = 2000;
const SERVER_SAVE_MS = 800;
let savedTimer: ReturnType<typeof setTimeout> | undefined;
function announceSaved() {
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => emitAppEvent("brand-dna:saved"), SAVED_SETTLE_MS);
}

export function brandDnaCacheKey(workspaceId: string) {
  return `brand-dna:v3:${workspaceId}`;
}

type Entry = {
  dna: BrandDna;
  status: "idle" | "loading" | "ready" | "error";
  listeners: Set<() => void>;
  saveTimer?: ReturnType<typeof setTimeout>;
};

const entries = new Map<string, Entry>();

function readCache(workspaceId: string): BrandDna | null {
  if (typeof window === "undefined") return null;
  for (const k of [
    brandDnaCacheKey(workspaceId),
    `brand-dna:v2:${workspaceId}`,
    `brand-dna:${workspaceId}`,
  ]) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) return { ...emptyDna, ...JSON.parse(raw) };
    } catch {
      /* unreadable cache */
    }
  }
  return null;
}

function writeCache(workspaceId: string, dna: BrandDna) {
  try {
    localStorage.setItem(brandDnaCacheKey(workspaceId), JSON.stringify(dna));
  } catch {
    /* storage full or unavailable */
  }
  try {
    saveDesignMd(workspaceId, buildDesignMd(dna));
  } catch {
    /* noop */
  }
}

function entryFor(workspaceId: string): Entry {
  let entry = entries.get(workspaceId);
  if (!entry) {
    entry = { dna: readCache(workspaceId) ?? emptyDna, status: "idle", listeners: new Set() };
    entries.set(workspaceId, entry);
  }
  return entry;
}

function notify(entry: Entry) {
  for (const l of entry.listeners) l();
}

function hasContent(dna: Partial<BrandDna> | null | undefined): boolean {
  return Boolean(dna && (dna.updatedAt || countBrandDnaFilled(dna as BrandDna).filled > 0));
}

async function loadFromServer(workspaceId: string) {
  const entry = entryFor(workspaceId);
  if (entry.status === "loading" || entry.status === "ready") return;
  entry.status = "loading";
  try {
    const { getBrandDna, saveBrandDna } = await import("@/lib/brand-dna.functions");
    const stored = await getBrandDna({ data: { workspaceId } });
    if (stored && hasContent(stored.dna as Partial<BrandDna>)) {
      // A local edit made while loading wins; otherwise the database does.
      if (!entry.saveTimer) {
        entry.dna = { ...emptyDna, ...(stored.dna as Partial<BrandDna>) };
        writeCache(workspaceId, entry.dna);
      }
    } else if (hasContent(entry.dna)) {
      // One-time migration of Brand DNA that only ever lived in this browser.
      await saveBrandDna({ data: { workspaceId, dna: entry.dna as never } });
    }
    entry.status = "ready";
  } catch {
    entry.status = "error";
  }
  notify(entry);
}

function scheduleServerSave(workspaceId: string) {
  const entry = entryFor(workspaceId);
  clearTimeout(entry.saveTimer);
  entry.saveTimer = setTimeout(async () => {
    entry.saveTimer = undefined;
    try {
      const { saveBrandDna } = await import("@/lib/brand-dna.functions");
      await saveBrandDna({ data: { workspaceId, dna: entry.dna as never } });
    } catch (e) {
      console.warn("[brand-dna] save failed", e);
    }
  }, SERVER_SAVE_MS);
}

/** Save Brand DNA for an explicit workspace (non-hook callers, e.g. onboarding). */
export function saveBrandDnaFor(workspaceId: string, next: Partial<BrandDna>, replace = false) {
  const entry = entryFor(workspaceId);
  entry.dna = { ...(replace ? emptyDna : entry.dna), ...next, updatedAt: Date.now() };
  writeCache(workspaceId, entry.dna);
  notify(entry);
  scheduleServerSave(workspaceId);
  announceSaved();
  return entry.dna;
}

/** Current Brand DNA for a workspace (cached copy; never another workspace's). */
export function readBrandDnaFor(workspaceId: string | null | undefined): BrandDna {
  return workspaceId ? entryFor(workspaceId).dna : emptyDna;
}

/** Test hook: forget every loaded workspace entry. */
export function resetBrandDnaStore() {
  for (const e of entries.values()) clearTimeout(e.saveTimer);
  entries.clear();
}

export function useBrandDna(workspaceId: string | null) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!workspaceId) return;
    const entry = entryFor(workspaceId);
    const listener = () => setTick((n) => n + 1);
    entry.listeners.add(listener);
    setTick((n) => n + 1);
    void loadFromServer(workspaceId);
    return () => {
      entry.listeners.delete(listener);
    };
  }, [workspaceId]);

  // Read straight from the workspace's own entry on every render: after a
  // switch the very first render already shows the new workspace (or empty).
  const dna = workspaceId && typeof window !== "undefined" ? entryFor(workspaceId).dna : emptyDna;

  const save = (next: Partial<BrandDna>) => {
    if (!workspaceId) return;
    saveBrandDnaFor(workspaceId, next);
  };

  const replace = (next: BrandDna) => {
    if (!workspaceId) return;
    saveBrandDnaFor(workspaceId, next, true);
  };

  const { filled, total } = countBrandDnaFilled(dna);

  return { dna, save, replace, filledCount: filled, total };
}

/** How many of the essential Brand DNA fields hold a value. */
export function countBrandDnaFilled(
  dna: Partial<Pick<BrandDna, "colors" | "logoUrl" | "audienceTags">> & {
    [K in (typeof TEXT_FIELDS)[number]]?: unknown;
  },
): { filled: number; total: number } {
  const filled =
    TEXT_FIELDS.filter((f) => String(dna[f] ?? "").trim()).length +
    ((dna.colors?.length ?? 0) > 0 ? 1 : 0) +
    (dna.logoUrl ? 1 : 0) +
    ((dna.audienceTags?.length ?? 0) > 0 ? 1 : 0);
  return { filled, total: TEXT_FIELDS.length + 3 };
}
