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
    // Product and people photos kept in Inspo (ADR-0037) come first.
    const { data: inspo } = await supabase
      .from("brand_visual_sources")
      .select("asset_id")
      .eq("workspace_id", workspaceId)
      .eq("status", "approved")
      .in("purpose", ["product", "person"])
      .order("created_at", { ascending: false })
      .limit(40);
    const inspoIds = (inspo ?? []).map((row) => row.asset_id);
    const photos = () =>
      supabase
        .from("assets")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("asset_type", "image")
        .eq("status", "ready")
        .in("mime_type", ["image/jpeg", "image/png", "image/webp", "image/gif"]);
    const [recent, pinned] = await Promise.all([
      photos().order("created_at", { ascending: false }).limit(40),
      inspoIds.length ? photos().in("id", inspoIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (recent.error || pinned.error) throw new HttpError(503, "Could not load your photos.");
    const kept = new Set((pinned.data ?? []).map((row) => row.id));
    const ids = [
      ...inspoIds.filter((id) => kept.has(id)),
      ...(recent.data ?? []).map((row) => row.id),
    ];
    const assets = await resolveStudioReferences(
      supabase,
      workspaceId,
      [...new Set(ids)].slice(0, 40),
      40,
    );
    return { assets };
  },
});
