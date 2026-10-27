import { z } from "zod";
import { defineRoute } from "@/server/route";
import { StudioTypeSchema, BrandPayloadSchema } from "@/lib/studio/jobs";
import { generateStudioIdeas } from "@/server/studio/ideas.server";
import { requireBillingFeature } from "@/server/billing/feature.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  workspaceId: z.string().uuid(),
  type: StudioTypeSchema.optional(),
  brand: BrandPayloadSchema,
  dismissed: z.array(z.string().max(160)).max(30).optional(),
  refresh: z.boolean().optional(),
  limit: z.number().int().min(2).max(8).optional(),
});

/** Fresh, signal-anchored ideas for what to create next. */
export const POST = defineRoute({
  name: "studio/ideas",
  auth: "workspace",
  minRole: "editor",
  body: Body,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "generate",
  handler: async ({ body, workspaceId, userId, role, supabase }) => {
    // This endpoint is also called on mount and after saving content. Suggestions
    // are included: browsing and saving must never create a wallet reservation.
    await requireBillingFeature({ workspaceId, userId, role, feature: "studio", spending: true });
    return generateStudioIdeas({
      client: supabase,
      workspaceId,
      brand: body.brand,
      type: body.type,
      dismissed: body.dismissed,
      refresh: body.refresh,
      limit: body.limit,
    });
  },
});
