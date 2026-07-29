import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonError, requireUserId } from "@/server/api-auth";
import { AiGatewayError, extractionCompletion } from "@/lib/ai";
import { FILE_EXTRACT_SYSTEM } from "@/lib/ai/prompts";

const Body = z.object({
  filename: z.string().max(200),
  mime: z.string().max(120),
  dataUrl: z.string().min(20).max(28_000_000),
});

export const Route = createFileRoute("/api/file-extract")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUserId(request);
        if (!auth.ok) return auth.response;

        let body: z.infer<typeof Body>;
        try { body = Body.parse(await request.json()); }
        catch { return jsonError(400, "Invalid request body"); }

        const isImage = body.mime.startsWith("image/") || body.dataUrl.startsWith("data:image/");
        if (!isImage) return jsonError(400, "Only images are supported by this endpoint");

        try {
          const j: any = await extractionCompletion({
            messages: [{
              role: "user",
              content: [
                { type: "text", text: FILE_EXTRACT_SYSTEM },
                { type: "image_url", image_url: { url: body.dataUrl } },
              ],
            }],
          });
          const text: string = j?.choices?.[0]?.message?.content ?? "";
          return Response.json({ text });
        } catch (e) {
          if (e instanceof AiGatewayError) return jsonError(e.status, e.message);
          throw e;
        }
      },
    },
  },
});
