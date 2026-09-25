// Live run of article publishing to the connected WordPress site (reads .env):
//
//   a Studio article (fixture content item) → previewPublication: the site is
//   resolved and proven, the blog detected, the GEO gate passes
//   SITES_LIVE_WRITE=yes: a publication row → the worker creates the post on
//   WordPress → verification fetches the live page → the post is trashed.
//
// Opt-in: npx vitest run --config vitest.live.config.ts tests/live/article-publish.live.ts
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => undefined,
}));

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — suite skips below.
}

const ready =
  !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.WORDPRESS_TOKEN_ENCRYPTION_KEY;
const WRITE = process.env.SITES_LIVE_WRITE === "yes";

const words = (n: number, seed: string) =>
  Array.from({ length: n }, (_, i) => `${seed}${i % 25}`).join(" ");

(ready ? describe : describe.skip)("Article publishing to WordPress (live)", () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterAll(async () => {
    for (const fn of cleanup.reverse())
      await Promise.resolve()
        .then(fn)
        .catch((e) => console.warn("[live] cleanup", e));
  });

  it("previews, publishes and checks a real article", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: conn } = await supabaseAdmin
      .from("workspace_connections")
      .select("workspace_id")
      .eq("provider", "wordpress")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!conn) return console.warn("[live] no WordPress connection — skipped");
    const workspaceId = conn.workspace_id;
    const { data: owner } = await supabaseAdmin
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .eq("role", "owner")
      .limit(1)
      .single();
    const userId = owner!.user_id;
    const { data: ws } = await supabaseAdmin
      .from("workspaces")
      .select("domain")
      .eq("id", workspaceId)
      .single();
    const { clientFor } = await import("@/server/connectors/wordpress/service.server");
    const { client, siteUrl } = await clientFor(workspaceId);
    const siteHost = new URL(siteUrl).hostname;
    console.info(`[live] workspace domain ${ws?.domain} · WordPress ${siteHost}`);

    const stamp = Date.now().toString(36);
    const { data: item, error } = await supabaseAdmin
      .from("content_items")
      .insert({
        workspace_id: workspaceId,
        created_by: userId,
        kind: "blog",
        channel: "blog",
        status: "approved",
        title: `How small teams keep a CRM tidy (${stamp})`,
        body: `Small teams keep a CRM tidy by giving one person ownership and reviewing it every week.\n\n## Why CRMs get messy\n\nA CRM gets messy when nobody owns it and every deal is logged differently. ${words(140, "messy")}\n\n## What to do each week\n\n- Close stale deals\n- Merge duplicates\n\n${words(140, "weekly")}\n\n## Next step\n\nPick an owner today. ${words(60, "next")}`,
        meta: {
          article: {
            dek: "A short routine that keeps a small team's CRM useful.",
            metaDescription:
              "How small teams keep a CRM tidy: one owner, a weekly review, and a few simple rules for logging deals so the data stays useful.",
            takeaways: ["Give the CRM one owner.", "Review it weekly."],
            faq: [
              {
                question: "Who should own the CRM?",
                answer: "One person on the team, usually whoever runs sales.",
              },
              {
                question: "How often should we clean it?",
                answer: "A short weekly review is enough for most small teams.",
              },
            ],
            slug: `tidy-crm-small-teams-${stamp}`,
            category: "Sales",
            tags: ["crm"],
          },
        },
      })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    cleanup.push(() => supabaseAdmin.from("content_items").delete().eq("id", item!.id) as never);

    const ctx = {
      supabase: supabaseAdmin as never,
      userId,
      workspaceId,
      canPropose: true,
      canManage: true,
    };
    const svc = await import("@/server/articles/publish.server");
    const preview = await svc.previewPublication(ctx, {
      contentItemId: item!.id,
      recheckBlog: true,
      host: siteHost,
    });
    console.info(`[live] targets: ${preview.targets.join(", ")}`);
    console.info(
      `[live] site: ${preview.site?.provider} verified=${preview.site?.verified} · blog: ${preview.blog?.status} ${preview.blog?.blogUrl}`,
    );
    for (const c of preview.gate.checks)
      console.info(`[live]   gate ${c.ok ? "✓" : "✗"} ${c.label} — ${c.detail}`);
    console.info(
      `[live] canPublish=${preview.canPublish} reason=${preview.reason} structuredData=${preview.structuredData}`,
    );
    expect(preview.site?.provider).toBe("wordpress");
    expect(preview.blog?.status).toBe("detected");
    expect(preview.gate.ok).toBe(true);

    if (!WRITE) return console.info("[live] SITES_LIVE_WRITE not set — stopping before the write");

    // A site in "coming soon" mode refuses approval; the worker is exercised directly then.
    let publicationId: string;
    if (preview.canPublish) {
      publicationId = (
        await svc.approvePublication(ctx, { contentItemId: item!.id, host: siteHost })
      ).id;
    } else {
      const { data: pub } = await (supabaseAdmin as never as { from: (t: string) => any })
        .from("site_publications")
        .insert({
          workspace_id: workspaceId,
          content_item_id: item!.id,
          host: siteHost,
          provider: "wordpress",
          slug: `tidy-crm-small-teams-${stamp}`,
          title: `How small teams keep a CRM tidy (${stamp})`,
          status: "approved",
          approved_by: userId,
          payload_hash: null,
        })
        .select("id")
        .single();
      publicationId = pub.id;
    }
    await svc.runDuePublications({ id: publicationId, budgetMs: 180_000, max: 3 });
    const pub = await svc.getPublication(ctx, publicationId);
    console.info(`[live] publication: ${pub.status} — ${pub.statusDetail}`);
    console.info(`[live] url: ${pub.url}`);
    for (const c of pub.checks)
      console.info(`[live]   live ${c.ok ? "✓" : "✗"} ${c.label} — ${c.detail}`);
    const { data: raw } = await (supabaseAdmin as never as { from: (t: string) => any })
      .from("site_publications")
      .select("external_id")
      .eq("id", publicationId)
      .single();
    if (raw?.external_id)
      cleanup.push(() => client.send(`wp/v2/posts/${raw.external_id}`, null, { method: "DELETE" }));
    expect(raw?.external_id).toBeTruthy();
    const post = await client.getObject("post", Number(raw.external_id));
    console.info(`[live] WordPress post #${post.id} status=${post.status} link=${post.link}`);
    expect(post.status).toBe("publish");
    expect(post.content).toContain("Frequently asked questions");
    expect(["verified", "verifying", "needs_attention"]).toContain(pub.status);
  }, 600_000);

  // Read-only: where a verified repository keeps its posts. Opens no pull request.
  it("detects the blog folder of a verified GitHub repository", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as never as { from: (t: string) => any };
    const { data: source } = await db
      .from("workspace_sources")
      .select("id, workspace_id, full_name, site_host")
      .eq("status", "active")
      .in("ownership_status", ["verified", "attested"])
      .not("site_host", "is", null)
      .limit(1)
      .maybeSingle();
    if (!source) return console.warn("[live] no verified repository — skipped");
    const { resolveSite } = await import("@/server/sites/resolve.server");
    const resolution = await resolveSite(source.workspace_id, source.site_host);
    console.info(
      `[live] candidates: ${JSON.stringify(resolution.candidates.map((c) => [c.provider, c.verified, c.proof]))} problems: ${resolution.problems.join(" / ")}`,
    );
    console.info(
      `[live] ${source.full_name} → ${source.site_host}: ${resolution.binding?.provider} verified=${resolution.binding?.verified}`,
    );
    // Detection only reads the repository, so a stale ownership proof is fine here;
    // publishing itself still requires resolution.binding (a current proof).
    const binding = resolution.binding ?? resolution.candidates[0];
    if (binding?.provider !== "github") return;
    const { ensureBlogSettings, blogView } = await import("@/server/articles/blog.server");
    const blog = await ensureBlogSettings(source.workspace_id, source.site_host, binding, {
      force: true,
    });
    console.info(`[live] blog: ${JSON.stringify(blogView(blog))}`);
    expect(["detected", "missing"]).toContain(blog.status);
  }, 120_000);
});
