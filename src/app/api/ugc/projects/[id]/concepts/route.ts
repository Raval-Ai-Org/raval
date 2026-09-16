// POST /api/ugc/projects/:id/concepts — generate grounded ad concepts for the
// project's product and brief, or rewrite the current script.
import { GenerateConceptsBody } from "@/lib/ugc/schemas";
import { HttpError } from "@/server/http-error";
import { defineRoute } from "@/server/route";
import { generateConcepts, rewriteScript } from "@/server/ugc/concepts.server";
import { assertUgcEnabled, idAfter } from "@/server/ugc/route-helpers";
import {
  getProjectView,
  projectContext,
  saveConcepts,
  updateProject,
} from "@/server/ugc/service.server";

export const dynamic = "force-dynamic";
export const maxDuration = 240;

export const POST = defineRoute({
  name: "ugc/projects:concepts",
  auth: "workspace",
  minRole: "editor",
  body: GenerateConceptsBody,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "ugc-draft",
  handler: async ({ request, body, workspaceId, supabase }) => {
    assertUgcEnabled(workspaceId);
    const id = idAfter(request, "projects");
    const ctx = await projectContext(supabase, workspaceId, id);
    if (!ctx.product.name) throw new HttpError(400, "Add the product first.");
    const conceptCtx = {
      product: ctx.product,
      brief: ctx.brief,
      brand: ctx.brand,
      workspace: ctx.workspace,
      durationSec: body.durationSec ?? 8,
    };
    if (body.mode === "rewrite") {
      if (!ctx.script) throw new HttpError(400, "Pick a concept before rewriting its script.");
      if (!body.instruction?.trim()) throw new HttpError(400, "Say how the script should change.");
      const { script, warnings } = await rewriteScript(conceptCtx, ctx.script, body.instruction);
      const project = await updateProject(supabase, workspaceId, id, { script });
      return { project, warnings };
    }
    const concepts = await generateConcepts(conceptCtx);
    await saveConcepts(supabase, workspaceId, id, concepts);
    return { project: await getProjectView(supabase, workspaceId, id), warnings: [] };
  },
});
