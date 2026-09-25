// Live check of Brand Kit Styles against the real Supabase project (reads .env).
//
// Always (no AI spend): create a style in the first workspace, upload an
// example image through a real signed upload URL, add a writing sample, and
// resolve the style the way every generator does (server-side Brand DNA,
// signed reference URLs, prompt blocks).
//
// With BRAND_KIT_LIVE_ANALYZE=yes (paid): study both examples with Claude,
// merge them into a suggested style, then write one real LinkedIn post with the
// Studio prompt and check it against the style's rules.
//
// Everything it creates is deleted; it never changes the workspace's default.
//   npx vitest run --config vitest.live.config.ts tests/live/brand-kit.live.ts
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — the suite skips below.
}

const describeLive = process.env.SUPABASE_SERVICE_ROLE_KEY ? describe : describe.skip;
const PAID = process.env.BRAND_KIT_LIVE_ANALYZE === "yes";

const SAMPLE = `We shipped the new calendar today. It took us three rewrites and one very long weekend.
Ship it. Then listen.
What would you want it to do next? Reply and tell us. #buildinpublic #mellox`;

describeLive("Brand Kit (live)", () => {
  let workspaceId = "";
  let userId = "";
  let styleId = "";
  const assetIds: string[] = [];

  afterAll(async () => {
    const store = await import("@/server/brand-kit/store.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (const id of assetIds) await store.deleteAsset(workspaceId, id).catch(() => null);
    if (styleId) await supabaseAdmin.from("brand_styles").delete().eq("id", styleId);
  });

  it("creates a style, uploads examples and resolves it for generators", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const store = await import("@/server/brand-kit/store.server");
    const assets = await import("@/server/brand-kit/assets.server");
    const { loadResolvedStyle, styleTextFor } = await import("@/server/brand-kit/resolve.server");
    const { visualStyleBlock } = await import("@/lib/brand-kit/prompt");

    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("id, owner_id")
      .order("created_at")
      .limit(1)
      .single();
    workspaceId = ws!.id;
    userId = ws!.owner_id;

    const created = await store.createStyle({
      workspaceId,
      userId,
      name: "Live test style",
      appliesTo: ["social", "image"],
      spec: {
        writing: { voice: "Short and direct", emoji: "none", bannedWords: ["synergy"] },
        visual: { medium: "flat", mood: "sunny and friendly", palette: { primary: "#f5a623" } },
      },
    });
    styleId = created.id;
    expect(created.isDefault).toBe(false);

    // A real signed upload, exactly like the browser does it.
    const bytes = readFileSync("public/assets/stars/star-spark.png");
    const ticket = await assets.startUpload({
      workspaceId,
      kind: "inspiration_image",
      mime: "image/png",
      bytes: bytes.length,
      fileName: "star-spark.png",
    });
    expect(ticket.path.startsWith(`workspace/${workspaceId}/assets/brand-kit/`)).toBe(true);
    const put = await supabaseAdmin.storage
      .from("generated-assets")
      .uploadToSignedUrl(ticket.path, ticket.token, bytes, { contentType: "image/png" });
    expect(put.error).toBeNull();
    const done = await assets.finishUpload({
      workspaceId,
      userId,
      assetId: ticket.assetId,
      kind: "inspiration_image",
      path: ticket.path,
      styleId,
      width: 1024,
      height: 1024,
    });
    assetIds.push(done.assetId);
    expect(done.analyze).toBe(true);

    // A path outside the workspace is refused before anything is written.
    await expect(
      assets.finishUpload({
        workspaceId,
        userId,
        assetId: ticket.assetId,
        kind: "inspiration_image",
        path: `workspace/00000000-0000-0000-0000-000000000000/assets/brand-kit/${ticket.assetId}/original.png`,
      }),
    ).rejects.toThrow();

    const sample = await assets.addWritingSample({ workspaceId, userId, text: SAMPLE, styleId });
    assetIds.push(sample.assetId);

    // Attach the example as an exact reference and resolve like a generator does.
    await store.updateStyle({
      workspaceId,
      userId,
      styleId,
      patch: {
        spec: {
          ...created.spec,
          references: [{ assetId: done.assetId, strength: "exact" }],
        },
      },
    });
    const loaded = await loadResolvedStyle(workspaceId, styleId);
    expect(loaded.resolved.styleId).toBe(styleId);
    expect(loaded.resolved.visual.palette.primary).toBe("#f5a623");
    expect(loaded.referenceUrls).toHaveLength(1);
    const ref = await fetch(loaded.referenceUrls[0]);
    expect(ref.ok).toBe(true);
    expect(visualStyleBlock(loaded.resolved)).toContain("Medium: flat");

    // The default style is untouched, and "none" really means Brand DNA only.
    expect((await loadResolvedStyle(workspaceId, "none")).resolved.styleId).toBeNull();
    expect(await styleTextFor(workspaceId, styleId, "social")).toContain("Never use: synergy");

    const overview = await store.loadOverview(supabaseAdmin as never, workspaceId, {
      canEdit: true,
    });
    expect(overview.assets.find((a) => a.id === done.assetId)?.url).toMatch(/^https:\/\//);
  });

  (PAID ? it : it.skip)(
    "studies the examples with Claude and writes a post in the style",
    async () => {
      const { analyzeAsset, suggestFromAssets } = await import("@/server/brand-kit/analyze.server");
      const { loadResolvedStyle } = await import("@/server/brand-kit/resolve.server");
      const { buildSocialPrompt, emptyContext } = await import("@/lib/studio/prompts");
      const { runStructuredPrompt } = await import("@/lib/ai");
      const { checkWritingConformance } = await import("@/lib/brand-kit/conformance");

      for (const id of assetIds) expect(await analyzeAsset(workspaceId, id)).toBe("done");
      const suggestion = await suggestFromAssets(workspaceId, assetIds);
      console.log("[brand-kit live] suggested", JSON.stringify(suggestion.spec, null, 2));
      expect(suggestion.spec.visual?.palette?.primary).toMatch(/^#[0-9a-f]{6}$/);
      expect(suggestion.spec.visual?.medium).toBeTruthy();
      expect(suggestion.spec.writing?.voice).toBeTruthy();

      const loaded = await loadResolvedStyle(workspaceId, styleId);
      const built = buildSocialPrompt({
        ctx: { ...emptyContext("Mellox"), style: loaded.resolved },
        intent: { brief: "Announce that our content calendar now supports drag and drop" },
        controls: { platforms: ["linkedin"] },
        angle: { id: "news", label: "News", directive: "Share what changed and why it matters." },
      } as never);
      const out = (await runStructuredPrompt({
        route: built.route,
        system: built.system,
        user: built.user,
        schema: built.schema as never,
        maxTokens: built.maxTokens,
        temperature: built.temperature,
      })) as { variants: Array<{ body: string }> };
      const body = out.variants[0].body;
      console.log("[brand-kit live] post:\n" + body);
      const conformance = checkWritingConformance(body, loaded.resolved);
      expect(conformance.issues.filter((i) => i.severity === "high")).toEqual([]);
    },
    180_000,
  );
});
