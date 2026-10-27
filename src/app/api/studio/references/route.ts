import { z } from "zod";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";
import { resolveStudioReferences } from "@/server/studio/references.server";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "studio/references",
  auth: "workspace",
  minRole: "editor",
  query: z.object({ workspaceId: z.string().uuid() }),
  workspaceId: ({ query }) => query.workspaceId,
  rateLimit: "billing-read",
  handler: async ({ workspaceId, supabase }) => {
    const { data, error } = await supabase
      .from("assets")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("asset_type", "image")
      .eq("status", "ready")
      .in("mime_type", ["image/jpeg", "image/png", "image/webp", "image/gif"])
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) throw new HttpError(503, "Could not load your photos.");
    const assets = await resolveStudioReferences(
      supabase,
      workspaceId,
      (data ?? []).map((row) => row.id),
      40,
    );
    return { assets };
  },
});
