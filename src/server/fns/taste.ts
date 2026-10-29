import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import type { ServerFnContext } from "@/server/server-fn";
import { HttpError } from "@/server/http-error";
import type { TasteView } from "@/lib/taste/contracts";

// Library hearts (ADR-0038, src/server/taste/). Reading needs membership; a
// heart teaches every later post, so setting one needs editor. Free.

const uuid = z.string().uuid();
const svc = () => import("@/server/taste/service.server");

async function caller(context: ServerFnContext, workspaceId: string, minRole: "viewer" | "editor") {
  const { isTasteEnabled } = await import("@/lib/feature-flags");
  if (!isTasteEnabled(workspaceId)) throw new HttpError(404, "Not found");
  const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
  const role = await requireWorkspaceRole(context, workspaceId, minRole);
  return { workspaceId, userId: context.userId, role };
}

export const getTaste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<TasteView> => {
    await caller(context, data.workspaceId, "viewer");
    return (await svc()).getTasteView(data.workspaceId);
  });

export const setReaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        contentItemId: uuid.optional(),
        assetId: uuid.optional(),
        reaction: z.enum(["love", "less"]).nullable(),
      })
      .refine((d) => !!d.contentItemId || !!d.assetId, "Choose a post or a picture.")
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<TasteView> => {
    const c = await caller(context, data.workspaceId, "editor");
    return (await svc()).setReaction(c, {
      contentItemId: data.contentItemId,
      assetId: data.assetId,
      reaction: data.reaction,
    });
  });

export const resetTaste = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("memory-write")])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }): Promise<TasteView> => {
    const c = await caller(context, data.workspaceId, "editor");
    return (await svc()).resetTaste(c);
  });
