import { z } from "zod";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";

export const dynamic = "force-dynamic";

// Where a signed-in person may go: straight in, or to /checkout first.
export const GET = defineRoute({
  name: "billing.access",
  auth: "user",
  query: z.object({ workspaceId: z.string().uuid().optional() }),
  rateLimit: "billing-read",
  handler: async ({ query, userId, supabase }) => {
    if (query.workspaceId) {
      const { data, error } = await supabase
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", query.workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !data) throw new HttpError(404, "Workspace not found.");
    }
    const { planAccess } = await import("@/server/billing/access.server");
    return planAccess(userId, query.workspaceId);
  },
});
