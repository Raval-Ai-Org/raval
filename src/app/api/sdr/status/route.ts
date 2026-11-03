// GET /api/sdr/status — is direct distribution enabled for this workspace, via
// which provider, and to which platforms? The Studio reads this to show
// publish/schedule controls only when they can actually deliver, and a
// manual-export path otherwise.
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { roleAtLeast } from "@/server/api-auth";
import {
  getDistributionProviderForWorkspace,
  isIntegrationsEnabled,
  isIntegrationsTesting,
} from "@/lib/feature-flags";
import { PROVIDER_PLATFORMS } from "@/lib/distribution-platforms";
import { connectablePlatforms } from "@/lib/social/routing";
import { composioConfigured } from "@/server/integrations/composio/gateway.server";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "sdr/status",
  auth: "workspace",
  query: z.object({ workspaceId: z.string().optional() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: ({ workspaceId, role }) => {
    const provider = getDistributionProviderForWorkspace(workspaceId);
    // On Post for Me, networks only Composio publishes (Pinterest) are listed
    // once they connect there; /api/sdr/oauth/start routes them the same way.
    const platforms =
      provider === "postforme"
        ? connectablePlatforms(PROVIDER_PLATFORMS.postforme, {
            composioReady: composioConfigured() && isIntegrationsEnabled(workspaceId),
            testing: isIntegrationsTesting(workspaceId),
          })
        : provider
          ? PROVIDER_PLATFORMS[provider]
          : [];
    return {
      enabled: provider !== null,
      canPublish: roleAtLeast(role, "editor"),
      role,
      provider,
      platforms,
    };
  },
});
