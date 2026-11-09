import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { z } from "zod";
import { FORMATS, PURPOSES } from "@/lib/brand-visuals/contracts";
import { finishUpload, problemMessage } from "@/server/brand-visuals/ingest.server";
import { uploadKind, uploadLabel } from "@/lib/inspo/uploads";

// Inspo uploads, step two: each file the browser put into storage is read
// back from this workspace's own path, checked, and saved. A file that fails
// gets its own plain reason; the others are still saved.
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = defineRoute({
  name: "brand-visuals/upload/finish",
  auth: "workspace",
  minRole: "editor",
  rateLimit: "upload",
  query: z.object({ workspaceId: z.string().uuid() }),
  body: z.object({
    purpose: z.enum(PURPOSES),
    format: z.union([z.literal("all"), z.enum(FORMATS)]).default("all"),
    campaign: z.string().max(120).optional(),
    items: z
      .array(
        z.object({
          id: z.string().uuid(),
          name: z.string().max(300),
          type: z.string().max(100),
          size: z.number().int().nonnegative(),
        }),
      )
      .min(1)
      .max(10),
  }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ body, workspaceId, userId, role }) => {
    if (body.items.filter((i) => uploadKind(i.type) === "video").length > 3)
      return jsonError(400, "Send at most three videos at a time.");
    const c = { workspaceId, userId, role };
    const results = [];
    for (const item of body.items) {
      try {
        const { assetId } = await finishUpload(c, item, {
          purpose: body.purpose,
          label: uploadLabel(item.name),
          format: body.format,
          campaign: body.campaign || undefined,
        });
        results.push({ id: item.id, assetId });
      } catch (error) {
        if (!(error instanceof Error && error.name === "UploadProblem"))
          console.warn("[inspo-upload] finish failed", error instanceof Error ? error.message : "");
        results.push({
          id: item.id,
          error: problemMessage(error, uploadKind(item.type) ?? "image"),
        });
      }
    }
    return Response.json({ results });
  },
});
