import { jsonError, requireUserId } from "@/server/api-auth";

export const dynamic = "force-dynamic";

// Streaming image generation via the custom AI gateway.
// Passes through SSE events (image_generation.partial_image / .completed)
// so the client can render progressive previews.
export async function POST(request: Request) {
  const auth = await requireUserId(request);
  if (!auth.ok) return auth.response;

  const ALLOWED_SIZES = ["1024x1024", "1792x1024", "1024x1792"] as const;
  const ALLOWED_STYLES = [
    "realistic_image",
    "digital_illustration",
    "vector_illustration",
  ] as const;
  type AllowedSize = (typeof ALLOWED_SIZES)[number];
  type AllowedStyle = (typeof ALLOWED_STYLES)[number];
  let body: {
    prompt?: unknown;
    size?: unknown;
    style?: unknown;
    hasReference?: unknown;
    editing?: unknown;
    requiredQuality?: unknown;
    iteration?: unknown;
    latency?: unknown;
    referenceAssets?: unknown;
    metadata?: unknown;
    maxAttempts?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid request body");
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 4000).trim() : "";
  if (!prompt) return jsonError(400, "Prompt required");
  let size: AllowedSize = "1024x1024";
  if (body.size !== undefined) {
    if (typeof body.size !== "string" || !ALLOWED_SIZES.includes(body.size as AllowedSize)) {
      return jsonError(400, "Invalid size");
    }
    size = body.size as AllowedSize;
  }
  let style: AllowedStyle | undefined;
  if (body.style !== undefined) {
    if (typeof body.style !== "string" || !ALLOWED_STYLES.includes(body.style as AllowedStyle)) {
      return jsonError(400, "Invalid style");
    }
    style = body.style as AllowedStyle;
  }

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
      body.iteration === "refinement" || body.iteration === "variation" ? body.iteration : "first",
    latency: body.latency === "fast" ? "fast" : "normal",
  } as const;
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : undefined;
  const maxAttempts = typeof body.maxAttempts === "number" ? body.maxAttempts : undefined;

  const { imageGenerationStream, KieGatewayError } = await import("@/lib/kie-gateway.server");
  try {
    return await imageGenerationStream({ prompt, size, routing, metadata, maxAttempts });
  } catch (e) {
    if (e instanceof KieGatewayError) return jsonError(e.status, e.message);
    throw e;
  }
}
