import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createPostForMeAdapter } from "@/lib/postforme/client.server";
import { listAccountsHandler, syncPostHandler } from "@/lib/postforme/handlers";
import { postForMeDb, getPostForMeDeps } from "@/lib/postforme/workspace.server";

export const dynamic = "force-dynamic";

const Event = z.object({ event_type: z.string(), data: z.record(z.unknown()) });
const secretMatches = (given: string | null, expected: string) => {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.POST_FOR_ME_WEBHOOK_SECRET ?? "";
  if (!secret) return Response.json({ error: "Webhook not configured" }, { status: 503 });
  if (!secretMatches(request.headers.get("Post-For-Me-Webhook-Secret"), secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 1_000_000)
    return Response.json({ error: "Payload too large" }, { status: 413 });
  let parsed: z.infer<typeof Event>;
  try {
    parsed = Event.parse(JSON.parse(raw));
  } catch {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }
  const data = parsed.data;
  try {
    if (
      parsed.event_type === "social.post.updated" ||
      parsed.event_type === "social.post.result.created"
    ) {
      const postId = parsed.event_type === "social.post.updated" ? data.id : data.post_id;
      if (typeof postId === "string") {
        await syncPostHandler(
          { postId },
          {
            api: createPostForMeAdapter("__webhook__"),
            db: postForMeDb,
          },
        );
      }
    } else if (
      parsed.event_type === "social.account.created" ||
      parsed.event_type === "social.account.updated"
    ) {
      const workspaceId = data.external_id;
      if (typeof workspaceId === "string" && z.string().uuid().safeParse(workspaceId).success) {
        await listAccountsHandler(workspaceId, getPostForMeDeps(workspaceId));
      }
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Could not process event" }, { status: 503 });
  }
}
