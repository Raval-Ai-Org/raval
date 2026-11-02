// Live check of the Wix connector against a workspace that has connected Wix
// (reads .env). Needs Mellox's Wix app credentials and a site that installed it.
//
//   reads     a fresh access token from the stored instance id → the app
//             instance (site, address, installed Wix apps) → resolveSite
//             proves the site against its live page → Wix Blog: newest posts
//             → the static pages' SEO tags and which page the home URL is
//   SITES_LIVE_WRITE=yes
//             the home page's meta description is set to a marked value
//             through the same CMS fix path, read back, then put back exactly
//             as it was; and one short article is published to Wix Blog as a
//             real post (left in place so a person can delete it in Wix)
//
// Opt-in: npx vitest run --config vitest.live.config.ts tests/live/wix.live.ts
import { describe, expect, it, vi } from "vitest";

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
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.WIX_CLIENT_ID &&
  !!process.env.WIX_CLIENT_SECRET;
const WRITE = process.env.SITES_LIVE_WRITE === "yes";

async function wixWorkspace() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("workspace_connections")
    .select("workspace_id")
    .eq("provider", "wix")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return data?.workspace_id ?? null;
}

(ready ? describe : describe.skip)("Wix connector (live)", () => {
  it("reads the connected site, proves it and finds its pages", async () => {
    const workspaceId = await wixWorkspace();
    if (!workspaceId) {
      console.warn("[live] no workspace has a Wix connection — skipped");
      return;
    }
    const { wixAccess, refreshSite } = await import("@/server/connectors/wix/service.server");
    const api = await import("@/server/connectors/wix/api.server");
    const view = await refreshSite(workspaceId);
    expect(view?.site?.id).toBeTruthy();
    const { token, site } = await wixAccess(workspaceId);
    console.info(`[live] ${site.name} · ${site.url ?? "unpublished"} · blog: ${site.hasBlog}`);

    const host = site.domains[0];
    if (!host) {
      console.warn("[live] the Wix site isn't published — nothing more to check");
      return;
    }
    const { resolveSite } = await import("@/server/sites/resolve.server");
    const resolution = await resolveSite(workspaceId, host, { live: true });
    console.info(`[live] live page: ${resolution.fingerprint?.platform ?? "unknown"}`);
    expect(resolution.fingerprint?.platform).toBe("wix");
    expect(resolution.binding?.provider).toBe("wix");
    expect(resolution.binding?.verified).toBe(true);

    if (site.hasBlog) {
      const posts = (await api.listPosts(token, 3)).posts ?? [];
      console.info(`[live] newest posts: ${posts.map((p) => p.slug).join(", ") || "none"}`);
    }
    const pages = await api.listItemSeoTags(token, "STATIC_PAGE");
    expect(pages.length).toBeGreaterThan(0);
    const { matchStaticPage } = await import("@/lib/sites/wix-seo");
    const home = matchStaticPage(pages, `https://${host}/`, site.domains);
    console.info(`[live] ${pages.length} static pages; home page item: ${home ?? "not matched"}`);
  }, 120_000);

  (WRITE ? it : it.skip)(
    "changes the home page's description through the fix path and puts it back",
    async () => {
      const workspaceId = await wixWorkspace();
      if (!workspaceId) return;
      const { openCmsSession, readField } = await import("@/server/geo/cms/access.server");
      const { applyCmsChanges, rollbackCmsChanges } = await import("@/server/geo/cms/apply.server");
      const { resolvePageTarget } = await import("@/server/geo/cms/targets.server");
      const session = await openCmsSession(workspaceId, "wix", { write: true });
      if (session.provider !== "wix") throw new Error("unexpected session");
      const host = session.site.domains[0];
      const page = await resolvePageTarget(session, `https://${host}/`);
      if (!page.target) {
        console.warn("[live] the home page couldn't be matched to a Wix page — skipped");
        return;
      }
      const key = "meta:name:description";
      const before = await readField(session, { target: page.target, key });
      const marked = `Mellox live check ${new Date().toISOString()}`;
      const change = {
        target: page.target,
        field: "meta_description" as const,
        key,
        label: "Meta description",
        before,
        after: marked,
        reason: "live check",
      };
      const applied = await applyCmsChanges(session, [change]);
      expect(await readField(session, { target: page.target, key })).toBe(marked);
      const undone = await rollbackCmsChanges(session, [change], applied.snapshot);
      expect(undone.restored).toBe(1);
      expect(await readField(session, { target: page.target, key })).toBe(before);
    },
    180_000,
  );

  (WRITE ? it : it.skip)(
    "publishes a short article to Wix Blog as a real post",
    async () => {
      const workspaceId = await wixWorkspace();
      if (!workspaceId) return;
      const { wixAccess } = await import("@/server/connectors/wix/service.server");
      const api = await import("@/server/connectors/wix/api.server");
      const { articleRicos } = await import("@/lib/articles/wix-ricos");
      const { token, site, ownerEmail } = await wixAccess(workspaceId);
      if (!site.hasBlog) {
        console.warn("[live] the Wix site has no blog — skipped");
        return;
      }
      const memberId =
        (await api.listPosts(token, 5)).posts?.find((p) => p.memberId)?.memberId ??
        (ownerEmail ? (await api.findMemberByEmail(token, ownerEmail)).members?.[0]?.id : null);
      if (!memberId) {
        console.warn("[live] no author found on the Wix site — skipped");
        return;
      }
      const slug = `mellox-live-check-${Date.now().toString(36)}`;
      const article = {
        title: `Mellox live check ${slug.slice(-6)}`,
        dek: "",
        metaDescription: "A post Mellox published to check its Wix connection.",
        takeaways: ["Published by a live check"],
        markdown:
          "This post checks that **Mellox** can publish to this blog.\n\n## Next\n\n- Delete it",
        faq: [],
        slug,
        category: null,
        tags: [],
      };
      const created = await api.createPublishedPost(token, {
        title: article.title,
        memberId,
        seoSlug: slug,
        richContent: articleRicos(article),
        excerpt: article.metaDescription,
      });
      expect(created.draftPost?.id).toBeTruthy();
      let post = null;
      for (let i = 0; i < 5 && !post; i++) {
        post = await api.getPostBySlug(token, slug);
        if (!post) await new Promise((r) => setTimeout(r, 3000));
      }
      console.info(
        `[live] post: ${post ? `${post.url?.base}${post.url?.path}` : "not listed yet"}`,
      );
      expect(post?.slug).toBe(slug);
    },
    120_000,
  );
});
