"use client";

// Browser client for the UGC Video Ads API. Every call goes through
// authedFetch (session token + workspace attribution). Prices, allowance and
// model capabilities always come from the server.
import { authedFetch } from "@/lib/authed-fetch";
import type {
  AllowanceView,
  Brief,
  ModelView,
  Product,
  ProjectSummary,
  ProjectView,
  ReferenceImageView,
  RenderView,
  Script,
} from "./schemas";

export class UgcApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "UgcApiError";
  }
}

async function call<T>(path: string, init: RequestInit & { workspaceId: string }): Promise<T> {
  let response: Response;
  const { workspaceId, ...rest } = init;
  try {
    response = await authedFetch(path, {
      ...rest,
      workspaceId,
      headers:
        rest.body instanceof FormData
          ? rest.headers
          : { "Content-Type": "application/json", ...(rest.headers ?? {}) },
    });
  } catch {
    throw new UgcApiError(
      0,
      "You appear to be offline. Your ad is saved — try again when you're back.",
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
            ? "You've hit the limit for now. Try again in a little while."
            : `Request failed (${response.status})`;
    throw new UgcApiError(response.status, message);
  }
  return json as T;
}

const q = (workspaceId: string) => `workspaceId=${encodeURIComponent(workspaceId)}`;

export type ReferenceUpload = ReferenceImageView & { width: number; height: number };

export const ugcApi = {
  models(workspaceId: string) {
    return call<{ models: ModelView[]; defaultModel: string; allowance: AllowanceView }>(
      `/api/ugc/models?${q(workspaceId)}`,
      { workspaceId },
    );
  },
  extract(workspaceId: string, url: string) {
    return call<{ product: Product; analyzed: boolean }>("/api/ugc/products/extract", {
      method: "POST",
      workspaceId,
      body: JSON.stringify({ workspaceId, url }),
    });
  },
  listProjects(workspaceId: string) {
    return call<{ projects: ProjectSummary[] }>(`/api/ugc/projects?${q(workspaceId)}`, {
      workspaceId,
    }).then((r) => r.projects);
  },
  createProject(
    workspaceId: string,
    input: { product: Product; brief: Partial<Brief>; referenceAssetIds: string[]; title?: string },
  ) {
    return call<{ project: ProjectView }>("/api/ugc/projects", {
      method: "POST",
      workspaceId,
      body: JSON.stringify({ workspaceId, ...input }),
    }).then((r) => r.project);
  },
  getProject(workspaceId: string, id: string) {
    return call<{ project: ProjectView }>(`/api/ugc/projects/${id}?${q(workspaceId)}`, {
      workspaceId,
    }).then((r) => r.project);
  },
  updateProject(
    workspaceId: string,
    id: string,
    patch: Partial<{
      title: string;
      product: Product;
      brief: Brief;
      selectedConceptId: string | null;
      script: Script | null;
      referenceAssetIds: string[];
    }>,
  ) {
    return call<{ project: ProjectView }>(`/api/ugc/projects/${id}`, {
      method: "PATCH",
      workspaceId,
      body: JSON.stringify({ workspaceId, ...patch }),
    }).then((r) => r.project);
  },
  archiveProject(workspaceId: string, id: string) {
    return call<{ ok: true }>(`/api/ugc/projects/${id}?${q(workspaceId)}`, {
      method: "DELETE",
      workspaceId,
    });
  },
  writeNotes(workspaceId: string, id: string, brief: Brief, current?: string) {
    return call<{ notes: string }>(`/api/ugc/projects/${id}/notes`, {
      method: "POST",
      workspaceId,
      body: JSON.stringify({ workspaceId, brief, current: current?.trim() || undefined }),
    });
  },
  generateConcepts(workspaceId: string, id: string, durationSec: number) {
    return call<{ project: ProjectView; warnings: string[] }>(`/api/ugc/projects/${id}/concepts`, {
      method: "POST",
      workspaceId,
      body: JSON.stringify({ workspaceId, mode: "concepts", durationSec }),
    });
  },
  rewriteScript(workspaceId: string, id: string, instruction: string, durationSec: number) {
    return call<{ project: ProjectView; warnings: string[] }>(`/api/ugc/projects/${id}/concepts`, {
      method: "POST",
      workspaceId,
      body: JSON.stringify({ workspaceId, mode: "rewrite", instruction, durationSec }),
    });
  },
  uploadReference(workspaceId: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return call<{ reference: ReferenceUpload }>(`/api/ugc/references/upload?${q(workspaceId)}`, {
      method: "POST",
      workspaceId,
      body: form,
    }).then((r) => r.reference);
  },
  importReference(workspaceId: string, url: string) {
    return call<{ reference: ReferenceUpload }>("/api/ugc/references/import", {
      method: "POST",
      workspaceId,
      body: JSON.stringify({ workspaceId, url }),
    }).then((r) => r.reference);
  },
  startRender(
    workspaceId: string,
    input: {
      projectId: string;
      idempotencyKey: string;
      model: string;
      durationSec: number;
      aspectRatio: string;
      resolution: string;
      referenceAssetIds: string[];
    },
  ) {
    return call<{ render: RenderView; created: boolean }>("/api/ugc/renders", {
      method: "POST",
      workspaceId,
      body: JSON.stringify({ workspaceId, ...input }),
    });
  },
  getRender(workspaceId: string, id: string) {
    return call<{ render: RenderView }>(`/api/ugc/renders/${id}?${q(workspaceId)}`, {
      workspaceId,
    }).then((r) => r.render);
  },
  cancelRender(workspaceId: string, id: string) {
    return call<{ render: RenderView }>(`/api/ugc/renders/${id}/cancel`, {
      method: "POST",
      workspaceId,
      body: JSON.stringify({ workspaceId }),
    }).then((r) => r.render);
  },
  download(workspaceId: string, id: string) {
    return call<{ url: string; filename: string }>(
      `/api/ugc/renders/${id}/download?${q(workspaceId)}`,
      {
        workspaceId,
      },
    );
  },
  postDraft(workspaceId: string, id: string) {
    return call<{ contentItemId: string }>(`/api/ugc/renders/${id}/post-draft`, {
      method: "POST",
      workspaceId,
      body: JSON.stringify({ workspaceId }),
    });
  },
};
