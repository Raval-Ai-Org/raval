// GET /api/sdr/accounts — list the workspace's connected accounts (FR-002).
// Tokens are never exposed. Provisions on first use (G3rd-7) so a fresh
// workspace returns a clean empty list rather than an error.
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrConfig } from "@/lib/sdr.helpers.server";
import { listAccountsHandler } from "@/lib/sdr.handlers";
import { isSdrEnabledForWorkspace } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "sdr/accounts",
  auth: "workspace",
  query: z.object({ workspaceId: z.string().optional() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ workspaceId }) => {
    // Distribution off → no SDR exists to provision against; an empty list is the truth.
    if (!isSdrEnabledForWorkspace(workspaceId)) return Response.json([]);
    try {
      const { token, baseUrl } = await getWorkspaceSdrConfig(workspaceId);
      const out = await listAccountsHandler({ sdrBaseUrl: baseUrl, token });
      return Response.json(out.body, { status: out.status });
    } catch (e) {
      return jsonError(503, e instanceof Error ? e.message : "SDR provisioning failed");
    }
  },
});
