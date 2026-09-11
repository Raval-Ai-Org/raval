import { z } from "zod";
import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  aspectRatio: z.enum(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"]).default("16:9"),
  duration: z
    .number()
    .int()
    .refine((value) => [4, 6, 8].includes(value), {
      message: "Video duration must be 4, 6, or 8 seconds.",
    })
    .default(6),
  resolution: z.enum(["480P", "720P", "1080P"]).default("720P"),
  audio: z.boolean().default(true),
  seed: z.number().int().min(0).max(2_147_483_647).default(0),
});

export const POST = defineRoute({
  name: "generate-video",
  auth: "user",
  body: BodySchema,
  // The most expensive call in the product (Veo 3.1, billed per video).
  rateLimit: "video",
  handler: async ({ body }) => {
    const { videoGeneration } = await import("@/lib/kie-gateway.server");
    const result = await videoGeneration(body);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  },
});
