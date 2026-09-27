import { z } from "zod";
import { defineRoute } from "@/server/route";
import {
  BrandPayloadSchema,
  ControlsSchema,
  IntentSchema,
  StudioTypeSchema,
} from "@/lib/studio/jobs";
import { writeStudioPrompt } from "@/server/studio/prompt-writer.server";
import { runMetered } from "@/server/billing/metered.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  workspaceId: z.string().uuid(),
  type: StudioTypeSchema,
  brand: BrandPayloadSchema,
  current: z.string().max(4000).optional(),
  template: z.string().max(40).optional(),
  goal: IntentSchema.shape.goal,
  controls: ControlsSchema.partial().optional(),
  styleId: z.union([z.string().uuid(), z.literal("none")]).nullish(),
  avoid: z.array(z.string().max(160)).max(30).optional(),
});

/** "Write it for me": a detailed, timely description for a Studio format. */
export const POST = defineRoute({
  name: "studio/prompt",
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
        route: "studio.prompt",
      },
      () =>
        writeStudioPrompt({
          client: supabase,
          workspaceId,
          brand: body.brand,
          type: body.type,
          current: body.current,
          template: body.template,
          goal: body.goal,
          controls: body.controls,
          styleId: body.styleId,
          avoid: body.avoid,
        }),
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
