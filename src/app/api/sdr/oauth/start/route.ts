// POST /api/sdr/oauth/start — proxy OAuth connect/reconnect to the SDR (FR-001/FR-004).
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrKey } from "@/lib/sdr.helpers.server";
import { oauthStartHandler } from "@/lib/sdr.handlers";

export const dynamic = "force-dynamic";

// platform is validated by oauthStartHandler, which owns the 400 for it.
const BodySchema = z.object({ workspaceId: z.unknown(), platform: z.unknown() });

export const POST = defineRoute({
  name: "sdr/oauth/start",
  auth: "workspace",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  handler: async ({ body, workspaceId }) => {
    try {
      const token = await getWorkspaceSdrKey(workspaceId);
      const out = await oauthStartHandler(String(body.platform ?? ""), {
        sdrBaseUrl: process.env.SDR_BASE_URL ?? "",
        token,
      });
      return Response.json(out.body, { status: out.status });
    } catch (e) {
      return jsonError(503, e instanceof Error ? e.message : "SDR provisioning failed");
    }
  },
});
