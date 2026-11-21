import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { z } from "zod";
import { presignAssetUpload } from "@/server/assets/storage.server";
import { countedReferences } from "@/server/brand-visuals/service.server";
import { inboxPath } from "@/server/brand-visuals/ingest.server";
import {
  MAX_FILES_PER_BATCH,
  MAX_REFERENCES,
  uploadKind,
  uploadProblem,
} from "@/lib/inspo/uploads";

// Inspo uploads, step one: the browser lists its files and gets one signed
// PUT per file, straight into storage under this workspace. Nothing is saved
// as a reference until /finish has read the file back.
export const dynamic = "force-dynamic";
export const POST = defineRoute({
  name: "brand-visuals/upload/start",
  auth: "workspace",
  minRole: "editor",
  rateLimit: "upload",
  query: z.object({ workspaceId: z.string().uuid() }),
  body: z.object({
    files: z
      .array(
        z.object({
          name: z.string().max(300),
          type: z.string().max(100),
          size: z.number().int().nonnegative(),
        }),
      )
      .min(1)
      .max(MAX_FILES_PER_BATCH),
  }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ body, workspaceId }) => {
    const room = MAX_REFERENCES - (await countedReferences(workspaceId)).length;
    if (room <= 0) return jsonError(409, "Remove an unused reference before adding another.");
    const items = [];
    let accepted = 0;
    for (const file of body.files) {
      const problem = uploadProblem(file);
      if (problem) {
        items.push({ name: file.name, error: problem });
        continue;
      }
      if (accepted >= room) {
        items.push({ name: file.name, error: `Inspo holds up to ${MAX_REFERENCES} references.` });
        continue;
      }
      accepted += 1;
      const id = crypto.randomUUID();
      const upload = await presignAssetUpload(inboxPath(workspaceId, id, file.type), file.type);
      items.push({
        id,
        name: file.name,
        type: file.type,
        size: file.size,
        kind: uploadKind(file.type),
        upload,
      });
    }
    return Response.json({ items });
  },
});
