import "server-only";
import { createServerFn, type ServerFnContext } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { getWorkspaceRole } from "@/server/workspace-access.server";
import { roleAtLeast } from "@/server/api-auth";
import { ForbiddenError } from "@/server/http-error";

// Publishing Studio articles to the workspace's own website
// (src/server/articles/publish.server.ts). Reading needs membership;
// publishing, cancelling and blog setup need editor.

const uuid = z.string().uuid();
const host = z
  .string()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9.-]+$/i);
const slug = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .optional();

async function publishContext(context: ServerFnContext, workspaceId: string) {
  const role = await getWorkspaceRole(context, workspaceId);
  if (!role) throw new ForbiddenError();
  const { supabase, userId } = context;
  return {
    supabase,
    userId,
    workspaceId,
    canPropose: roleAtLeast(role, "editor"),
    canManage: roleAtLeast(role, "admin"),
  };
}

function requireEditor(ctx: { canPropose: boolean }) {
  if (!ctx.canPropose) throw new ForbiddenError("Editor role required");
}

export const previewArticlePublish = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        contentItemId: uuid,
        slug,
        host: host.optional(),
        recheckBlog: z.boolean().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/articles/publish.server");
    return svc.previewPublication(await publishContext(context, data.workspaceId), data);
  });

export const publishArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        contentItemId: uuid,
        slug,
        host: host.optional(),
        scheduledFor: z.string().datetime().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await publishContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/articles/publish.server");
    return svc.approvePublication(ctx, data);
  });

export const getArticlePublication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid, publicationId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const svc = await import("@/server/articles/publish.server");
    return svc.getPublication(await publishContext(context, data.workspaceId), data.publicationId);
  });

export const cancelArticlePublication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid, publicationId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = await publishContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/articles/publish.server");
    return svc.cancelPublication(ctx, data.publicationId);
  });

export const recheckArticlePublication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((data) => z.object({ workspaceId: uuid, publicationId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    const ctx = await publishContext(context, data.workspaceId);
    requireEditor(ctx);
    const svc = await import("@/server/articles/publish.server");
    return svc.recheckPublication(ctx, data.publicationId);
  });

/**
 * Add a blog to the site: a Webflow collection, or (GitHub) a pull request with
 * blog pages that match the site. "ready" says a Webflow template page is designed.
 */
export const setupSiteBlog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, action: z.enum(["create", "ready"]), host }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const ctx = await publishContext(context, data.workspaceId);
    requireEditor(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { publishTargets } = await import("@/server/articles/publish.server");
    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("domain")
      .eq("id", data.workspaceId)
      .single();
    const target = data.host.toLowerCase().replace(/^www\./, "");
    if (!(await publishTargets(data.workspaceId, ws?.domain ?? null)).includes(target))
      throw new ForbiddenError(`${data.host} isn't one of this workspace's websites.`);
    const blog = await import("@/server/articles/blog.server");
    if (data.action === "ready")
      return blog.blogView(await blog.markBlogReady(data.workspaceId, target));
    const { resolveSite } = await import("@/server/sites/resolve.server");
    const provider = (await resolveSite(data.workspaceId, target)).binding?.provider;
    if (provider === "github") {
      const { startGithubBlogSetup } = await import("@/server/articles/blog-setup.server");
      return blog.blogView(
        await startGithubBlogSetup({ workspaceId: data.workspaceId, userId: ctx.userId }, target),
      );
    }
    return blog.blogView(await blog.createWebflowBlog(data.workspaceId, target));
  });
