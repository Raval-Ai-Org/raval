// POST /api/sdr/disconnect — disconnect a connected account at the active
// provider. SocialAPI.ai also revokes the platform grant where the platform
// supports it; the account must belong to this workspace's brand.
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrConfig } from "@/lib/sdr.helpers.server";
import { disconnectHandler } from "@/lib/sdr.handlers";
import { getDistributionProviderForWorkspace } from "@/lib/feature-flags";
import { disconnectHandler as disconnectSocialAccount } from "@/lib/socialapi/handlers";
import {
  distributionDisabledResponse,
  handlerResponse,
  withSocialApi,
} from "@/lib/socialapi/route.server";

export const dynamic = "force-dynamic";

// accountId is validated by the handlers, which own the 400 for it.
const BodySchema = z.object({ workspaceId: z.unknown(), accountId: z.unknown() });

export const POST = defineRoute({
  name: "sdr/disconnect",
  auth: "workspace",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  minRole: "editor",
  handler: async ({ body, workspaceId }) => {
    const accountId = typeof body.accountId === "string" ? body.accountId : "";
    const provider = getDistributionProviderForWorkspace(workspaceId);
    if (provider === "socialapi") {
      return withSocialApi(workspaceId, (deps) =>
        disconnectSocialAccount({ workspaceId, accountId }, deps),
      );
    }
    if (!provider) return distributionDisabledResponse();
    try {
      const { token, baseUrl } = await getWorkspaceSdrConfig(workspaceId);
      return handlerResponse(await disconnectHandler(accountId, { sdrBaseUrl: baseUrl, token }));
    } catch (e) {
      return jsonError(503, e instanceof Error ? e.message : "SDR provisioning failed");
    }
  },
});
