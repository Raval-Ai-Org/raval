// POST /api/ugc/references/import — copy a product-page image into Mellox
// storage (SSRF-guarded download, byte-validated) for use as a reference.
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { importReferenceFromUrl } from "@/server/ugc/references.server";
import { assertUgcEnabled } from "@/server/ugc/route-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = defineRoute({
  name: "ugc/references:import",
  auth: "workspace",
  minRole: "editor",
  body: z.object({ workspaceId: z.string().uuid(), url: z.string().url().max(2048) }),
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "ugc-draft",
  handler: async ({ body, workspaceId }) => {
    assertUgcEnabled(workspaceId);
    return { reference: await importReferenceFromUrl(workspaceId, body.url) };
  },
});
