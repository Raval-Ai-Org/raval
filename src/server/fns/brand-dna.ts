import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireWorkspaceRole } from "@/server/workspace-access.server";

// Brand DNA for one workspace. Members read; editors write. The workspace id
// is the request's own — never "the active workspace" — so a save that
// finishes after the user switched still lands on the brand it was made for.

const uuid = z.string().uuid();

export const getBrandDna = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const { readBrandDna } = await import("@/server/workspaces/brand-dna.server");
    const stored = await readBrandDna(context.supabase as never, data.workspaceId);
    return stored ? { workspaceId: data.workspaceId, ...stored } : null;
  });

export const saveBrandDna = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        dna: z.record(z.string(), z.unknown()),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { writeBrandDna } = await import("@/server/workspaces/brand-dna.server");
    const stored = await writeBrandDna({
      workspaceId: data.workspaceId,
      userId: context.userId,
      dna: data.dna,
    });
    const { invalidateStudioContext } = await import("@/server/studio/context.server");
    invalidateStudioContext(data.workspaceId);
    // Styles inherit colours, fonts, voice and logo from Brand DNA.
    const { invalidateStyleCache } = await import("@/server/brand-kit/resolve.server");
    invalidateStyleCache(data.workspaceId);
    return { workspaceId: data.workspaceId, version: stored.version, updatedAt: stored.updatedAt };
  });
