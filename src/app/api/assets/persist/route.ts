import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { persistAsset } from "@/server/assets/persist.server";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Fields are validated individually below; the schema only guarantees an object.
const BodySchema = z.record(z.unknown());

const str = (value: unknown) => (typeof value === "string" ? value : undefined);

export const POST = defineRoute({
  name: "assets/persist",
  auth: "workspace",
  // Writing to shared storage is a side effect: viewers can't, and a loop can't flood it.
  minRole: "editor",
  rateLimit: "generate",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ body, workspaceId }) => {
    const contentItemId = str(body.contentItemId) ?? null;
    if (contentItemId && !UUID_RE.test(contentItemId)) {
      return jsonError(400, "contentItemId must be a content item id");
    }
    const result = await persistAsset({
      workspaceId,
      idempotencyKey: str(body.idempotencyKey) ?? "",
      dataUrl: str(body.dataUrl),
      sourceUrl: str(body.sourceUrl),
      contentItemIds: contentItemId ? [contentItemId] : [],
      assetType: body.assetType === "video" ? "video" : "image",
      mimeType: str(body.mimeType),
      filename: str(body.filename),
      platform: str(body.platform) ?? null,
      provider: str(body.provider),
      model: str(body.model) ?? null,
      modelRoute: str(body.modelRoute) ?? null,
      promptVersion: str(body.promptVersion) ?? null,
      creativeBriefVersion: str(body.creativeBriefVersion) ?? null,
      brandDnaVersion: str(body.brandDnaVersion) ?? null,
      attempt: typeof body.attempt === "number" ? body.attempt : 1,
      seed: str(body.seed) ?? null,
      metadata:
        typeof body.metadata === "object" && body.metadata
          ? (body.metadata as Record<string, unknown>)
          : {},
    });
    if (!result.ok) return jsonError(result.status, result.message);
    return Response.json({ asset: result.asset, deduplicated: result.deduplicated });
  },
});
