import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonError, requireUserId, assertPublicUrl } from "@/server/api-auth";
import { AiGatewayError, chatCompletion } from "@/lib/ai";
import { TASK_SYSTEMS } from "@/lib/ai/prompts";
import { assemble } from "@/lib/ai/prompts/assemble";

const TaskEnum = z.enum([
  "seo-audit",
  "content-gen",
  "ad-copy",
  "social-post",
  "crm-message",
  "competitor",
  "analytics-insight",
  "freeform",
]);

const BodySchema = z.object({
  task: TaskEnum,
  prompt: z.string().max(4000).optional(),
  url: z.string().url().max(2000).optional(),
  context: z.string().max(4000).optional(),
});

export const Route = createFileRoute("/api/ai-generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUserId(request);
        if (!auth.ok) return auth.response;

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch {
          return jsonError(400, "Invalid request body");
        }

        const system = TASK_SYSTEMS[body.task] ?? TASK_SYSTEMS.freeform;

        // Optional: scrape page text (SSRF-guarded)
        let scraped = "";
        if (body.url) {
          try {
            const safeUrl = assertPublicUrl(body.url);
            const res = await fetch(safeUrl.toString(), {
              headers: { "User-Agent": "Mozilla/5.0 ThreeReachBot" },
              signal: AbortSignal.timeout(8000),
              redirect: "error",
            });
            if (res.ok) {
              scraped = (await res.text())
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<style[\s\S]*?<\/style>/gi, "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .slice(0, 4000);
            }
          } catch (e) {
            console.warn("scrape failed", e);
          }
        }

        const user =
          assemble([
            { label: "Request", body: body.prompt },
            { label: "Context", body: body.context, maxChars: 3800 },
            { label: "Target URL", body: body.url },
            { label: "Page content", body: scraped, maxChars: 4000 },
          ]) || "Generate a useful default response.";

        try {
          const json: any = await chatCompletion({
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            max_tokens: 900,
            temperature: 0.72,
          });
          const text = String(json?.choices?.[0]?.message?.content ?? "").trim();
          if (!text) return jsonError(502, "AI returned an empty draft");
          return Response.json({ text });
        } catch (e) {
          if (e instanceof AiGatewayError) return jsonError(e.status, e.message);
          throw e;
        }
      },
    },
  },
});
