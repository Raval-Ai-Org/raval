// POST /api/sdr/oauth/start — start connect/reconnect at the active provider.
// SocialAPI.ai: returns the platform consent URL; the result comes back to
// /app/social/connected carrying a one-time state bound to this user and
// workspace. The redirect target is never taken from an untrusted origin.
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrConfig } from "@/lib/sdr.helpers.server";
import { oauthStartHandler } from "@/lib/sdr.handlers";
import { getDistributionProviderForWorkspace } from "@/lib/feature-flags";
import { startConnectHandler } from "@/lib/socialapi/handlers";
import {
  distributionDisabledResponse,
  resolveConnectRedirect,
  withSocialApi,
} from "@/lib/socialapi/route.server";

export const dynamic = "force-dynamic";

// platform is validated by the handlers, which own the 400 for it.
const BodySchema = z.object({
  workspaceId: z.unknown(),
  platform: z.unknown(),
  origin: z.unknown().optional(),
});

export const POST = defineRoute({
  name: "sdr/oauth/start",
  auth: "workspace",
  body: BodySchema,
  workspaceId: ({ body }) => body.workspaceId,
  minRole: "editor",
  handler: async ({ body, workspaceId, userId }) => {
    const platform = typeof body.platform === "string" ? body.platform : "";
    const provider = getDistributionProviderForWorkspace(workspaceId);
    if (!provider) return distributionDisabledResponse();
    if (provider === "socialapi") {
      return withSocialApi(workspaceId, (deps) =>
        startConnectHandler(
          { workspaceId, userId, platform, redirectUri: resolveConnectRedirect(body.origin) },
          deps,
        ),
      );
    }
    try {
      const { token, baseUrl } = await getWorkspaceSdrConfig(workspaceId);
      const out = await oauthStartHandler(platform, { sdrBaseUrl: baseUrl, token });
      return Response.json(out.body, { status: out.status });
    } catch (e) {
      return jsonError(503, e instanceof Error ? e.message : "SDR provisioning failed");
    }
  },
});
