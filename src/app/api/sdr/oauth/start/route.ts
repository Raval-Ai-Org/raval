// POST /api/sdr/oauth/start — proxy OAuth connect/reconnect to the SDR (FR-001/FR-004).
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrConfig } from "@/lib/sdr.helpers.server";
import { oauthStartHandler, handleSdrDisabled } from "@/lib/sdr.handlers";
import { isSdrEnabledForWorkspace } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

// platform is validated by oauthStartHandler, which owns the 400 for it.
const BodySchema = z.object({ workspaceId: z.unknown(), platform: z.unknown() });

export const POST = defineRoute({
  name: "sdr/oauth/start",
  auth: "workspace",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  minRole: "editor",
  handler: async ({ body, workspaceId }) => {
    if (!isSdrEnabledForWorkspace(workspaceId)) {
      const out = await handleSdrDisabled({ workspaceId, contentItemIds: [], kind: "publish" });
      return Response.json({ error: out.body.error }, { status: out.status });
    }
    try {
      const { token, baseUrl } = await getWorkspaceSdrConfig(workspaceId);
      const out = await oauthStartHandler(String(body.platform ?? ""), {
        sdrBaseUrl: baseUrl,
        token,
      });
      return Response.json(out.body, { status: out.status });
    } catch (e) {
      return jsonError(503, e instanceof Error ? e.message : "SDR provisioning failed");
    }
  },
});
