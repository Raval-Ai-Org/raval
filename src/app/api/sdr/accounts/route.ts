// GET /api/sdr/accounts — list the workspace's connected accounts (FR-002).
// Tokens are never exposed. Provisions on first use (G3rd-7) so a fresh
// workspace returns a clean empty list rather than an error.
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrKey } from "@/lib/sdr.helpers.server";
import { listAccountsHandler } from "@/lib/sdr.handlers";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "sdr/accounts",
  auth: "workspace",
  query: z.object({ workspaceId: z.string().optional() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ workspaceId }) => {
    try {
      const token = await getWorkspaceSdrKey(workspaceId);
      const out = await listAccountsHandler({ sdrBaseUrl: process.env.SDR_BASE_URL ?? "", token });
      return Response.json(out.body, { status: out.status });
    } catch (e) {
      return jsonError(503, e instanceof Error ? e.message : "SDR provisioning failed");
    }
  },
});
