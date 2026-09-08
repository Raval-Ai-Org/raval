import { z } from "zod";
import { jsonError, requireUserId } from "@/server/api-auth";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  aspectRatio: z.enum(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"]).default("16:9"),
  duration: z
    .number()
    .int()
    .refine((value) => [4, 6, 8].includes(value), { message: "Video duration must be 4, 6, or 8 seconds." })
    .default(6),
  resolution: z.enum(["480P", "720P", "1080P"]).default("720P"),
  audio: z.boolean().default(true),
  seed: z.number().int().min(0).max(2_147_483_647).default(0),
});

export async function POST(request: Request) {
  const auth = await requireUserId(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return jsonError(400, "Invalid video generation request.");
  }

  const { videoGeneration, KieGatewayError } = await import("@/lib/kie-gateway.server");
  try {
    const result = await videoGeneration(body);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof KieGatewayError) return jsonError(error.status, error.message);
    return jsonError(502, "Video generation failed. Please try again.");
  }
}