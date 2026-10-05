import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrainOverview } from "@/lib/brain/brain";

// Brain (ADR-0032): the four brains and the strategy in one read. Membership
// is enough; nothing here spends or writes.

/** What every brain holds right now, and what changed. Free, no model call. */
export const getBrainOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<BrainOverview> => {
    const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const { loadBrainOverview } = await import("@/server/brain/overview.server");
    return loadBrainOverview(context.supabase as unknown as SupabaseClient, data.workspaceId);
  });
