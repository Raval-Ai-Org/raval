// GET /api/sdr/accounts — list the workspace's connected accounts from the
// active distribution provider. Tokens are never exposed. SocialAPI.ai lists
// only accounts under this workspace's brand; the SDR provisions on first use.
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrConfig } from "@/lib/sdr.helpers.server";
import { listAccountsHandler } from "@/lib/sdr.handlers";
import { getDistributionProviderForWorkspace } from "@/lib/feature-flags";
import { listAccountsHandler as listSocialAccounts } from "@/lib/socialapi/handlers";
import { withSocialApi } from "@/lib/socialapi/route.server";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "sdr/accounts",
  auth: "workspace",
  query: z.object({ workspaceId: z.string().optional() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ workspaceId }) => {
    const provider = getDistributionProviderForWorkspace(workspaceId);
    // Distribution off → no provider to ask; an empty list is the truth.
    if (!provider) return Response.json([]);
    if (provider === "socialapi") {
      return withSocialApi(workspaceId, (deps) => listSocialAccounts(workspaceId, deps));
    }
    try {
      const { token, baseUrl } = await getWorkspaceSdrConfig(workspaceId);
      const out = await listAccountsHandler({ sdrBaseUrl: baseUrl, token });
      return Response.json(out.body, { status: out.status });
    } catch (e) {
      return jsonError(503, e instanceof Error ? e.message : "SDR provisioning failed");
    }
  },
});
