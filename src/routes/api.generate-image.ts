import { createFileRoute } from "@tanstack/react-router";
import { jsonError, requireUserId } from "@/server/api-auth";

// Streaming image generation via the custom AI gateway.
// Passes through SSE events (image_generation.partial_image / .completed)
// so the client can render progressive previews.
export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
        let body: { prompt?: unknown; size?: unknown; style?: unknown };
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
          if (
            typeof body.style !== "string" ||
            !ALLOWED_STYLES.includes(body.style as AllowedStyle)
          ) {
            return jsonError(400, "Invalid style");
          }
          style = body.style as AllowedStyle;
        }

        const { imageGenerationStream, AiGatewayError } = await import("@/lib/ai-gateway.server");
        try {
          return await imageGenerationStream({ prompt, size, style });
        } catch (e) {
          if (e instanceof AiGatewayError) return jsonError(e.status, e.message);
          throw e;
        }
      },
    },
  },
});
