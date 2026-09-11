import { z } from "zod";
import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  prompt: z
    .string()
    .transform((value) => value.slice(0, 4000).trim())
    .pipe(z.string().min(1, "Prompt required")),
  size: z.enum(["1024x1024", "1792x1024", "1024x1792"]).default("1024x1024"),
  style: z.enum(["realistic_image", "digital_illustration", "vector_illustration"]).optional(),
  // Routing hints are advisory: unknown values fall back to the defaults
  // rather than failing the request, matching the previous behaviour.
  hasReference: z.unknown().optional(),
  referenceAssets: z.unknown().optional(),
  editing: z.unknown().optional(),
  requiredQuality: z.unknown().optional(),
  iteration: z.unknown().optional(),
  latency: z.unknown().optional(),
  metadata: z.unknown().optional(),
  maxAttempts: z.unknown().optional(),
});

// Streaming image generation via KIE. Passes through SSE events
// (image_generation.partial_image / .completed) so the client can render
// progressive previews.
export const POST = defineRoute({
  name: "generate-image",
  auth: "user",
  body: BodySchema,
  // Billed per image.
  rateLimit: "image",
  handler: async ({ body }) => {
    const routing = {
      hasReference: body.hasReference === true,
      referenceAssets: Array.isArray(body.referenceAssets)
        ? body.referenceAssets
            .filter(
              (value): value is string => typeof value === "string" && /^https:\/\//i.test(value),
            )
            .slice(0, 4)
        : [],
      editing: body.editing === true,
      requiredQuality:
        body.requiredQuality === "high" || body.requiredQuality === "maximum"
          ? body.requiredQuality
          : "standard",
      iteration:
        body.iteration === "refinement" || body.iteration === "variation"
          ? body.iteration
          : "first",
      latency: body.latency === "fast" ? "fast" : "normal",
    } as const;
    const metadata =
      body.metadata && typeof body.metadata === "object"
        ? (body.metadata as Record<string, unknown>)
        : undefined;
    const maxAttempts = typeof body.maxAttempts === "number" ? body.maxAttempts : undefined;

    const { imageGenerationStream } = await import("@/lib/kie-gateway.server");
    return imageGenerationStream({
      prompt: body.prompt,
      size: body.size,
      routing,
      metadata,
      maxAttempts,
    });
  },
});
