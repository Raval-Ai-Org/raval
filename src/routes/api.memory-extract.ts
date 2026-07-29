import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { jsonError, requireUserId } from "@/server/api-auth";
import { AiGatewayError, extractionCompletion } from "@/lib/ai";
import { safeParseJson } from "@/lib/ai/json";
import { logAiCall } from "@/lib/ai/token-log.server";
import { MEMORY_SYSTEM } from "@/lib/ai/prompts";
import { assemble } from "@/lib/ai/prompts/assemble";

const BodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant", "system"]), content: z.string().min(1).max(8000) }))
    .min(1).max(60),
  current: z
    .object({
      brandName: z.string().max(200).optional(),
      oneLiner: z.string().max(400).optional(),
      knownInsights: z.array(z.string().max(400)).max(50).optional(),
      knownCompetitors: z.array(z.string().max(200)).max(50).optional(),
      knownTriggers: z.array(z.string().max(400)).max(50).optional(),
      knownObjections: z.array(z.string().max(400)).max(50).optional(),
      knownFeedback: z.array(z.string().max(400)).max(50).optional(),
    })
    .optional(),
});

const EMPTY = { insights: [], competitors: [], triggerSignals: [], objectionSignals: [], feedbackSources: [] };

const MEMORY_TOOL = {
  type: "function" as const,
  function: {
    name: "save_memory",
    description: "Persist durable memory extracted from the chat.",
    parameters: {
      type: "object",
      properties: {
        insights: { type: "array", items: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title", "body"] } },
        competitors: { type: "array", items: { type: "object", properties: { name: { type: "string" }, url: { type: "string" }, positioning: { type: "string" }, strengths: { type: "string" }, weaknesses: { type: "string" }, notes: { type: "string" } }, required: ["name"] } },
        triggerSignals: { type: "array", items: { type: "object", properties: { text: { type: "string" }, sourceLabel: { type: "string" } }, required: ["text"] } },
        objectionSignals: { type: "array", items: { type: "object", properties: { text: { type: "string" }, sourceLabel: { type: "string" } }, required: ["text"] } },
        feedbackSources: { type: "array", items: { type: "object", properties: { text: { type: "string" }, sourceLabel: { type: "string" } }, required: ["text"] } },
        brand: { type: "object", properties: { brandName: { type: "string" }, oneLiner: { type: "string" }, voice: { type: "string" }, audience: { type: "string" }, uniqueValueProp: { type: "string" }, mission: { type: "string" }, vision: { type: "string" }, positioning: { type: "string" }, doRules: { type: "string" }, dontRules: { type: "string" } } },
      },
      required: ["insights", "competitors", "triggerSignals", "objectionSignals", "feedbackSources"],
    },
  },
};

export const Route = createFileRoute("/api/memory-extract")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUserId(request);
        if (!auth.ok) return auth.response;

        let body: z.infer<typeof BodySchema>;
        try { body = BodySchema.parse(await request.json()); }
        catch { return jsonError(400, "Invalid request body"); }

        const transcript = body.messages
          .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
          .join("\n\n").slice(0, 12_000);

        const known = body.current ?? {};
        const knownBlock = assemble([
          { body: `Brand: ${known.brandName ?? "(unknown)"}${known.oneLiner ? ` — ${known.oneLiner}` : ""}` },
          { label: "Known insights",   body: known.knownInsights?.slice(0, 20).join("; ") },
          { label: "Known competitors", body: known.knownCompetitors?.slice(0, 15).join("; ") },
          { label: "Known triggers",    body: known.knownTriggers?.slice(0, 15).join("; ") },
          { label: "Known objections",  body: known.knownObjections?.slice(0, 15).join("; ") },
          { label: "Known feedback",    body: known.knownFeedback?.slice(0, 15).join("; ") },
        ]);

        try {
          const json: any = await extractionCompletion({
            messages: [
              { role: "system", content: MEMORY_SYSTEM },
              { role: "user", content: `${knownBlock}\n\n## Transcript\n${transcript}` },
            ],
            tools: [MEMORY_TOOL],
            tool_choice: { type: "function", function: { name: "save_memory" } },
            max_tokens: 2000,
          });
          const args = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "";
          logAiCall({
            route: "memory-extract",
            model: "google/gemini-2.5-pro",
            inputChars: transcript.length + knownBlock.length + MEMORY_SYSTEM.length,
            outputChars: String(args).length,
            cached: json?._cached === true,
            toolCall: true,
          });
          return Response.json(safeParseJson<typeof EMPTY>(args, EMPTY));
        } catch (e) {
          if (e instanceof AiGatewayError) return jsonError(e.status, e.message);
          throw e;
        }
      },
    },
  },
});
