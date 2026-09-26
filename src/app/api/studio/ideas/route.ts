import { z } from "zod";
import { defineRoute } from "@/server/route";
import { StudioTypeSchema, BrandPayloadSchema } from "@/lib/studio/jobs";
import { generateStudioIdeas } from "@/server/studio/ideas.server";
import { runMetered } from "@/server/billing/metered.server";

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
  handler: async ({ body, workspaceId, userId, role, request, supabase }) => {
    const metered = await runMetered(
      {
        workspaceId,
        userId,
        role,
        action: "ideas",
        idempotencyKey: request.headers.get("Idempotency-Key") ?? crypto.randomUUID(),
        route: "studio.ideas",
      },
      async (charge) => {
        const result = await generateStudioIdeas({
          client: supabase,
          workspaceId,
          brand: body.brand,
          type: body.type,
          dismissed: body.dismissed,
          refresh: body.refresh,
          limit: body.limit,
        });
        if (result.generated !== "model" || result.cached) charge.setCapturedAmount(0);
        return result;
      },
    );
    return Response.json(
      metered.result,
      metered.balance === null
        ? undefined
        : {
            headers: { "X-Billing-Balance": String(metered.balance) },
          },
    );
  },
});
