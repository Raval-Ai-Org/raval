import { emitAppEvent } from "@/lib/app-events";
import { authedFetch } from "@/lib/authed-fetch";

export type PersistGeneratedAssetInput = {
  workspaceId: string;
  contentItemId?: string | null;
  dataUrl?: string;
  sourceUrl?: string;
  idempotencyKey: string;
  filename?: string;
  platform?: string | null;
  assetType?: "image" | "video";
  attempt?: number;
  seed?: string | null;
  promptVersion?: string;
  creativeBriefVersion?: string;
  brandDnaVersion?: string;
  model?: string | null;
  modelRoute?: string | null;
  metadata?: Record<string, unknown>;
};

export async function persistGeneratedAsset(input: PersistGeneratedAssetInput) {
  const response = await authedFetch("/api/assets/persist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => ({}))) as { asset?: unknown; error?: string };
  if (!response.ok || !payload.asset) throw new Error(payload.error || "Asset persistence failed");
  if (typeof window !== "undefined") emitAppEvent("assets:changed");
  return payload.asset;
}
