// POST /api/agents/run — "Run now" for a worker in this workspace (editor+).
//   { workspaceId, worker: "distribution-reliability" }
//   { workspaceId, worker: "content-fit", contentItemId }
// Workers are read-only or approval-gated by construction; running one never
// publishes or changes content by itself.
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { runWorker } from "@/server/agents/service";

export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("worker", [
  z.object({ workspaceId: z.string(), worker: z.literal("distribution-reliability") }),
  z.object({
    workspaceId: z.string(),
    worker: z.literal("content-fit"),
    contentItemId: z.string().uuid(),
  }),
]);

export const POST = defineRoute({
  name: "agents/run",
  auth: "workspace",
  minRole: "editor",
  body: Body,
  workspaceId: ({ body }) => body.workspaceId,
  rateLimit: ({ userId, workspaceId }) => ({ tier: "audit", subject: `${userId}:${workspaceId}` }),
  handler: async ({ body, workspaceId, userId }) => {
    const out = await runWorker({
      worker: body.worker,
      workspaceId,
      trigger: "manual",
      createdBy: userId,
      input: body.worker === "content-fit" ? { contentItemId: body.contentItemId } : {},
    });
    if (out.status === "failed" && !out.runId)
      return jsonError(409, out.error ?? "Agents are paused");
    return out;
  },
});
