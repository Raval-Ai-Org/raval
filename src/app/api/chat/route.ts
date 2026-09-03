import { z } from "zod";
import { jsonError, requireUserId } from "@/server/api-auth";
import { chatCompletionStream, AiGatewayError } from "@/lib/ai-gateway.server";
import { chatSystem, chatContextBlock } from "@/lib/ai/prompts";
import { compactHistory } from "@/lib/ai/history-compact";

export const dynamic = "force-dynamic";

const MessagesSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().min(1).max(200_000),
      }),
    )
    .min(1)
    .max(40),
  context: z.string().max(6000).optional(),
});

export async function POST(request: Request) {
  const auth = await requireUserId(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof MessagesSchema>;
  try {
    body = MessagesSchema.parse(await request.json());
  } catch {
    return jsonError(400, "Invalid request body");
  }

  const safeMessages = compactHistory(body.messages.filter((m) => m.role !== "system") as never);

  try {
    return await chatCompletionStream({
      stream: true,
      messages: [
        { role: "system", content: chatSystem() },
        { role: "system", content: chatContextBlock(body.context ?? "") },
        ...safeMessages,
      ],
    });
  } catch (e) {
    if (e instanceof AiGatewayError) return jsonError(e.status, e.message);
    throw e;
  }
}
