import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { requireWorkspaceRole } from "@/server/workspace-access.server";

const uuid = z.string().uuid();

/**
 * Generates a grounded campaign brief from the workspace's stored Brand DNA
 * (src/server/workflows/campaign-generation.workflow.ts). A paid Claude call
 * — editor role required.
 */
export const generateCampaignBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("generate")])
  .inputValidator((d) =>
    z
      .object({
        workspaceId: uuid,
        goal: z.string().min(3).max(500),
        channels: z.array(z.string().min(1).max(40)).min(1).max(6),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "editor");
    const { runWorkflow } = await import("@/server/workflows/mastra.server");
    return runWorkflow("campaignGeneration", {
      workspaceId: data.workspaceId,
      goal: data.goal,
      channels: data.channels,
    });
  });
