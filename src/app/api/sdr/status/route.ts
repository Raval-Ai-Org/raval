// GET /api/sdr/status — is direct distribution enabled for this workspace?
// The Studio reads this to show publish/schedule controls only when they can
// actually deliver, and a manual-export path otherwise.
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { roleAtLeast } from "@/server/api-auth";
import { isSdrEnabledForWorkspace } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "sdr/status",
  auth: "workspace",
  query: z.object({ workspaceId: z.string().optional() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: ({ workspaceId, role }) => ({
    enabled: isSdrEnabledForWorkspace(workspaceId),
    canPublish: roleAtLeast(role, "editor"),
    role,
  }),
});
