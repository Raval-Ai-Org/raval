// Opt-in check against a workspace's real Canva connection.
//   CANVA_LIVE_WORKSPACE_ID=<id> npx vitest run --config vitest.live.config.ts tests/live/canva.live.ts
// By default it only reads. The round trip (open in Canva, bring the edit
// back, go back to the original) creates designs in that Canva account and
// uses its Magic Layers allowance, so it needs CANVA_LIVE_WRITE=yes and
// CANVA_LIVE_CONTENT_IDS=<post id>[,<post id>]. Each post is left as found.
import { describe, expect, it } from "vitest";

for (const file of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // The host may inject environment variables directly.
  }
}

const workspaceId = process.env.CANVA_LIVE_WORKSPACE_ID ?? "";
const live = /^[0-9a-f-]{36}$/i.test(workspaceId) && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const contentIds = (process.env.CANVA_LIVE_CONTENT_IDS ?? "").split(",").filter(Boolean);
const write = live && process.env.CANVA_LIVE_WRITE === "yes" && contentIds.length > 0;

(live ? describe : describe.skip)("Canva connection (live)", () => {
  it("has a usable saved grant", async () => {
    const { canvaStatus, canvaAccessToken } =
      await import("@/server/connectors/canva/service.server");
    await expect(canvaStatus(workspaceId)).resolves.toMatchObject({ status: "active" });
    expect(await canvaAccessToken(workspaceId)).toBeTruthy();
  });
});

(write ? describe : describe.skip)("Canva round trip (live, writes)", () => {
  it.each(contentIds)(
    "opens %s as an editable design, brings it back and restores the original",
    async (contentId) => {
      const service = await import("@/server/connectors/canva/service.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
      const read = async () => {
        const { data } = await db
          .from("content_items")
          .select("status, meta")
          .eq("id", contentId)
          .eq("workspace_id", workspaceId)
          .single();
        return data as { status: string; meta: Record<string, unknown> };
      };
      const { data: grant } = await db
        .from("workspace_connections")
        .select("connected_by")
        .eq("workspace_id", workspaceId)
        .eq("provider", "canva")
        .single();
      const userId = grant!.connected_by as string;
      const before = await read();

      const opened = await service.editInCanva({ workspaceId, userId, contentId });
      console.log(contentId, "mode", opened.mode, "slides", opened.slideCount);
      expect(opened.mode).not.toBe("flat_image");
      expect(opened.editUrl).toMatch(/^https:\/\/www\.canva\.com\//);
      if (opened.slideCount > 1 && opened.mode === "magic_layers")
        expect(opened.slideDesigns).toHaveLength(opened.slideCount);

      try {
        const back = await service.importCanvaChanges({
          workspaceId,
          userId,
          mappingId: opened.mappingId,
        });
        expect(back.pageCount).toBe(opened.slideCount);
        expect(back.applied).toBeGreaterThan(0);
        const edited = await read();
        expect(edited.meta.asset_id).not.toBe(before.meta.asset_id);
        expect(edited.meta.canva_selected_version_id).toBe(back.versionId);
        if (Array.isArray(before.meta.asset_storage_paths))
          expect(edited.meta.asset_storage_paths).toHaveLength(
            before.meta.asset_storage_paths.length,
          );
        console.log(contentId, "now shows", edited.meta.asset_storage_path);
        await expect(service.canvaEditState(workspaceId, { contentId })).resolves.toMatchObject({
          mappingId: opened.mappingId,
          usingCanva: true,
        });
        // The brought-back picture reopens the design it came from.
        const again = await service.editInCanva({ workspaceId, userId, contentId });
        expect(again.designId).toBe(opened.designId);
      } finally {
        await service.restoreCanvaOriginal({ workspaceId, userId, mappingId: opened.mappingId });
        const after = await read();
        expect(after.meta.asset_id).toBe(before.meta.asset_id);
        expect(after.meta.asset_storage_paths).toEqual(before.meta.asset_storage_paths);
        await db
          .from("content_items")
          .update({ status: before.status })
          .eq("workspace_id", workspaceId)
          .contains("meta", { asset_id: before.meta.asset_id });
      }
    },
    300_000,
  );
});
