"use client";

// Browser client for the Studio API. Every call goes through authedFetch so
// the session token and workspace attribution travel with it.
import { authedFetch } from "@/lib/authed-fetch";
import type { StudioType } from "./formats";
import type { StudioIdea } from "./ideas";
import type { CreateJobInput, StudioJob } from "./jobs";

export class StudioApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "StudioApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await authedFetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new StudioApiError(
      0,
      "You appear to be offline. Your work is saved — try again when you're back.",
    );
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const raw = json.error;
    const message =
      typeof raw === "string"
        ? raw
        : raw &&
            typeof raw === "object" &&
            typeof (raw as { message?: unknown }).message === "string"
          ? String((raw as { message: string }).message)
          : response.status === 429
            ? "You've hit the generation limit for now. Try again in a little while."
            : `Request failed (${response.status})`;
    throw new StudioApiError(response.status, message);
  }
  return json as T;
}

export const studioApi = {
  createJob(input: CreateJobInput) {
    return call<{ job: StudioJob }>("/api/studio/jobs", {
      method: "POST",
      body: JSON.stringify(input),
    }).then((r) => r.job);
  },
  getJob(workspaceId: string, id: string) {
    return call<{ job: StudioJob }>(
      `/api/studio/jobs/${id}?workspaceId=${encodeURIComponent(workspaceId)}`,
    ).then((r) => r.job);
  },
  listJobs(workspaceId: string) {
    return call<{ jobs: StudioJob[] }>(
      `/api/studio/jobs?workspaceId=${encodeURIComponent(workspaceId)}`,
    ).then((r) => r.jobs);
  },
  cancelJob(workspaceId: string, id: string) {
    return call<{ job: StudioJob }>(`/api/studio/jobs/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ workspaceId }),
    }).then((r) => r.job);
  },
  ideas(args: {
    workspaceId: string;
    type?: StudioType;
    brand: Record<string, unknown> | null;
    dismissed?: string[];
    refresh?: boolean;
    limit?: number;
  }) {
    return call<{ ideas: StudioIdea[]; generated: "model" | "fallback"; cached: boolean }>(
      "/api/studio/ideas",
      { method: "POST", body: JSON.stringify(args) },
    );
  },
};

/** Brand DNA fields worth sending to the server (drops heavy/provenance data). */
const BRAND_FIELDS = [
  "brandName",
  "oneLiner",
  "about",
  "industry",
  "businessModel",
  "voice",
  "audience",
  "audienceTags",
  "values",
  "valueTags",
  "products",
  "doRules",
  "dontRules",
  "colors",
  "fonts",
  "logoUrl",
  "websiteUrl",
  "mission",
  "positioning",
  "uniqueValueProp",
  "keywords",
  "competitors",
  "customer",
  "userInsights",
];

export function readBrandPayload(workspaceId: string | null): Record<string, unknown> | null {
  if (!workspaceId || typeof window === "undefined") return null;
  for (const key of [
    `brand-dna:v3:${workspaceId}`,
    `brand-dna:v2:${workspaceId}`,
    `brand-dna:${workspaceId}`,
  ]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const field of BRAND_FIELDS) {
        const value = parsed[field];
        if (value == null || value === "" || (Array.isArray(value) && !value.length)) continue;
        out[field] = value;
      }
      const serialized = JSON.stringify(out);
      // Keep the request lean: very long insight lists are the usual culprit.
      if (serialized.length > 24_000 && Array.isArray(out.userInsights)) {
        out.userInsights = (out.userInsights as unknown[]).slice(0, 10);
      }
      return Object.keys(out).length ? out : null;
    } catch {
      /* ignore malformed storage */
    }
  }
  return null;
}
