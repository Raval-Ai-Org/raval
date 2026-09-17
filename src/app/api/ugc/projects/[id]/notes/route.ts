// POST /api/ugc/projects/:id/notes — "Write it for me" for a creator video ad's
// creative notes, grounded in the project's saved product facts.
import { z } from "zod";
import { BriefSchema } from "@/lib/ugc/schemas";
import { HttpError } from "@/server/http-error";
import { defineRoute } from "@/server/route";
import { writeCreativeNotes } from "@/server/ugc/notes-writer.server";
import { assertUgcEnabled, idAfter } from "@/server/ugc/route-helpers";
import { projectContext } from "@/server/ugc/service.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  workspaceId: z.string().uuid(),
  /** The brief as currently chosen on screen (may be unsaved). */
  brief: BriefSchema,
  current: z.string().max(1000).optional(),
});

export const POST = defineRoute({
  name: "ugc/projects:notes",
  auth: "workspace",
  minRole: "editor",
  body: Body,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "ugc-draft",
  handler: async ({ request, body, workspaceId, supabase }) => {
    assertUgcEnabled(workspaceId);
    const id = idAfter(request, "projects");
    const ctx = await projectContext(supabase, workspaceId, id);
    if (!ctx.product.name) throw new HttpError(400, "Add the product first.");
    return writeCreativeNotes({
      product: ctx.product,
      brief: body.brief,
      brand: ctx.brand,
      workspace: ctx.workspace,
      current: body.current,
    });
  },
});
