// /api/ugc/projects/:id — read (with renders), edit, or archive one UGC ad.
import { z } from "zod";
import { UpdateProjectBody, WorkspaceQuery } from "@/lib/ugc/schemas";
import { defineRoute } from "@/server/route";
import { idAfter } from "@/server/ugc/route-helpers";
import { archiveProject, getProjectView, updateProject } from "@/server/ugc/service.server";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "ugc/projects:get",
  auth: "workspace",
  query: WorkspaceQuery,
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ request, workspaceId, supabase }) => ({
    project: await getProjectView(supabase, workspaceId, idAfter(request, "projects")),
  }),
});

export const PATCH = defineRoute({
  name: "ugc/projects:update",
  auth: "workspace",
  minRole: "editor",
  body: UpdateProjectBody,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "generate",
  handler: async ({ request, body, workspaceId, supabase }) => ({
    project: await updateProject(supabase, workspaceId, idAfter(request, "projects"), body),
  }),
});

export const DELETE = defineRoute({
  name: "ugc/projects:archive",
  auth: "workspace",
  minRole: "editor",
  query: z.object({ workspaceId: z.string().uuid() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ request, workspaceId, supabase }) => {
    await archiveProject(supabase, workspaceId, idAfter(request, "projects"));
    return { ok: true };
  },
});
