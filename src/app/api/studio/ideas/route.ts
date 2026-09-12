import { z } from "zod";
import { defineRoute } from "@/server/route";
import { StudioTypeSchema, BrandPayloadSchema } from "@/lib/studio/jobs";
import { generateStudioIdeas } from "@/server/studio/ideas.server";

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
  body: Body,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "generate",
  handler: async ({ body, workspaceId, supabase }) =>
    generateStudioIdeas({
      client: supabase,
      workspaceId,
      brand: body.brand,
      type: body.type,
      dismissed: body.dismissed,
      refresh: body.refresh,
      limit: body.limit,
    }),
});
