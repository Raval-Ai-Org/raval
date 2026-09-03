import { z } from "zod";
import { jsonError, requireUserId } from "@/server/api-auth";
import { buildAgentTasks } from "@/lib/ai/deterministic-suggestions";

export const dynamic = "force-dynamic";

const safeText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .transform((s) =>
      s
        .replace(/[\u0000-\u001F\u007F]/g, " ")
        .replace(/[`<>]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );

const BodySchema = z.object({
  agentName: safeText(60),
  agentRole: safeText(120),
  missions: z
    .array(z.object({ label: safeText(80), description: safeText(280) }))
    .min(1)
    .max(10),
  existing: z.array(safeText(160)).max(20).optional(),
});

export async function POST(request: Request) {
  const auth = await requireUserId(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return jsonError(400, "Invalid request body");
  }

  // Deterministic — no LLM. Templated tasks from missions + existing dedupe.
  const tasks = buildAgentTasks(body);
  return Response.json({ tasks });
}
