import { z } from "zod";
import { defineRoute } from "@/server/route";
import {
  BrandPayloadSchema,
  ControlsSchema,
  IntentSchema,
  StudioTypeSchema,
} from "@/lib/studio/jobs";
import { writeStudioPrompt } from "@/server/studio/prompt-writer.server";

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
  avoid: z.array(z.string().max(160)).max(30).optional(),
});

/** "Write it for me": a detailed, timely description for a Studio format. */
export const POST = defineRoute({
  name: "studio/prompt",
  auth: "workspace",
  body: Body,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: "generate",
  handler: async ({ body, workspaceId, supabase }) =>
    writeStudioPrompt({
      client: supabase,
      workspaceId,
      brand: body.brand,
      type: body.type,
      current: body.current,
      template: body.template,
      goal: body.goal,
      controls: body.controls,
      avoid: body.avoid,
    }),
});
