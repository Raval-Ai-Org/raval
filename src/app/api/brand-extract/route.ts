import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { assertPublicUrl } from "@/server/safe-fetch";
import { normalizeUrl } from "@/lib/crawl/html";
import { runBrandExtraction } from "@/lib/brand-extract.server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  url: z.string().min(1).max(2000),
});

// Streams NDJSON events ({type: "progress" | "error" | "result"}) while the
// pipeline in src/lib/brand-extract.server.ts crawls and analyses the site.
export const POST = defineRoute({
  name: "brand-extract",
  auth: "user",
  body: BodySchema,
  // Multi-page crawl + Claude extraction — expensive and slow.
  rateLimit: "audit",
  handler: ({ body }) => {
    let safeUrl: URL;
    try {
      safeUrl = assertPublicUrl(normalizeUrl(body.url));
    } catch {
      return jsonError(400, "URL is not allowed");
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        await runBrandExtraction(safeUrl, (event) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          } catch {
            // Client disconnected; the pipeline finishes and is discarded.
          }
        });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  },
});
