// POST /api/sdr/disconnect — disconnect a connected account (FR-003).
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrKey } from "@/lib/sdr.helpers.server";
import { disconnectHandler } from "@/lib/sdr.handlers";

export const dynamic = "force-dynamic";

// accountId is validated by disconnectHandler, which owns the 400 for it.
const BodySchema = z.object({ workspaceId: z.unknown(), accountId: z.unknown() });

export const POST = defineRoute({
  name: "sdr/disconnect",
  auth: "workspace",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ body, workspaceId }) => {
    try {
      const token = await getWorkspaceSdrKey(workspaceId);
      const out = await disconnectHandler(String(body.accountId ?? ""), {
        sdrBaseUrl: process.env.SDR_BASE_URL ?? "",
        token,
      });
      return Response.json(out.body, { status: out.status });
    } catch (e) {
      return jsonError(503, e instanceof Error ? e.message : "SDR provisioning failed");
    }
  },
});
