// POST /api/sdr/oauth/start — start connect/reconnect at the active provider.
// SocialAPI.ai: returns the platform consent URL; the result comes back to
// /app/social/connected carrying a one-time state bound to this user and
// workspace. The redirect target is never taken from an untrusted origin.
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";
import { getWorkspaceSdrConfig } from "@/lib/sdr.helpers.server";
import { oauthStartHandler } from "@/lib/sdr.handlers";
import {
  getDistributionProviderForWorkspace,
  isIntegrationsEnabled,
  isIntegrationsTesting,
} from "@/lib/feature-flags";
import { routeSocialPlatform } from "@/lib/social/routing";
import { PROVIDER_PLATFORMS } from "@/lib/distribution-platforms";
import { composioConfigured } from "@/server/integrations/composio/gateway.server";
import { startConnect as startComposioConnect } from "@/server/integrations/accounts.server";
import { startConnectHandler } from "@/lib/socialapi/handlers";
import { startConnectHandler as startPostForMeConnect } from "@/lib/postforme/handlers";
import { withPostForMe } from "@/lib/postforme/route.server";
import {
  activateSocialProfileSlot,
  assertSocialProfileConnection,
  reserveSocialProfileSlot,
} from "@/server/billing/social-profiles.server";
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
  handler: async ({ body, workspaceId, userId, role }) => {
    const platform = typeof body.platform === "string" ? body.platform : "";
    const provider = getDistributionProviderForWorkspace(workspaceId);
    if (!provider) return distributionDisabledResponse();
    if (provider === "postforme") {
      const entitlements = await assertSocialProfileConnection({ workspaceId, userId, role });
      await reserveSocialProfileSlot(entitlements, workspaceId);
      // Instagram, Facebook (and more as they're checked) connect through
      // Composio when connected apps are on (ADR-0042); the rest stay here.
      const route = routeSocialPlatform(platform, {
        composioReady: composioConfigured() && isIntegrationsEnabled(workspaceId),
        testing: isIntegrationsTesting(workspaceId),
      });
      if (route.provider === "composio") {
        const { url } = await startComposioConnect({
          workspaceId,
          userId,
          app: platform,
          returnOrigin: typeof body.origin === "string" ? body.origin : null,
          returnPath: null,
        });
        return Response.json({ authorizationUrl: url });
      }
      // Pinterest has no Post for Me path: it connects through Composio or not at all.
      if (!(PROVIDER_PLATFORMS.postforme as string[]).includes(platform)) {
        return jsonError(400, `This network can't be connected right now. ${route.reason}`);
      }
      return withPostForMe(workspaceId, (deps) => startPostForMeConnect({ platform }, deps));
    }
    if (provider === "socialapi") {
      const entitlements = await assertSocialProfileConnection({ workspaceId, userId, role });
      await reserveSocialProfileSlot(entitlements, workspaceId);
      const response = await withSocialApi(workspaceId, (deps) =>
        startConnectHandler(
          { workspaceId, userId, platform, redirectUri: resolveConnectRedirect(body.origin) },
          deps,
        ),
      );
      if (response.ok) {
        const body = (await response
          .clone()
          .json()
          .catch(() => null)) as { connected?: boolean } | null;
        if (body?.connected) await activateSocialProfileSlot(entitlements, workspaceId);
      }
      return response;
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
