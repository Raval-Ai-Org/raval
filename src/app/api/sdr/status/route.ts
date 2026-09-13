// GET /api/sdr/status — is direct distribution enabled for this workspace, via
// which provider, and to which platforms? The Studio reads this to show
// publish/schedule controls only when they can actually deliver, and a
// manual-export path otherwise.
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { roleAtLeast } from "@/server/api-auth";
import { getDistributionProviderForWorkspace } from "@/lib/feature-flags";
import { PROVIDER_PLATFORMS } from "@/lib/distribution-platforms";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "sdr/status",
  auth: "workspace",
  query: z.object({ workspaceId: z.string().optional() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: ({ workspaceId, role }) => {
    const provider = getDistributionProviderForWorkspace(workspaceId);
    return {
      enabled: provider !== null,
      canPublish: roleAtLeast(role, "editor"),
      role,
      provider,
      platforms: provider ? PROVIDER_PLATFORMS[provider] : [],
    };
  },
});
