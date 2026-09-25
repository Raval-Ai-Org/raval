// Live check of the WordPress connection a workspace really has (reads .env):
// the unified REST client, platform fingerprint and site binding.
//
//   WORDPRESS_LIVE_WORKSPACE   workspace whose WordPress connection to use
//                              (default: the first workspace with one)
//   SITES_LIVE_WRITE=yes       also apply one reversible change and undo it
//
// Opt-in: npx vitest run --config vitest.live.config.ts tests/live/wordpress-site.live.ts
import { describe, expect, it } from "vitest";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env — suite skips below.
}

const ready =
  !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.WORDPRESS_TOKEN_ENCRYPTION_KEY;
const WRITE = process.env.SITES_LIVE_WRITE === "yes";

async function workspaceWithWordPress(): Promise<string | null> {
  if (process.env.WORDPRESS_LIVE_WORKSPACE) return process.env.WORDPRESS_LIVE_WORKSPACE;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("workspace_connections")
    .select("workspace_id")
    .eq("provider", "wordpress")
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return data?.workspace_id ?? null;
}

(ready ? describe : describe.skip)("WordPress site (live)", () => {
  it("reads settings, posts and pages through the unified client", async () => {
    const workspaceId = await workspaceWithWordPress();
    if (!workspaceId) {
      console.warn("[live] no workspace has a WordPress connection — skipped");
      return;
    }
    const { clientFor } = await import("@/server/connectors/wordpress/service.server");
    const { client, siteUrl, authType } = await clientFor(workspaceId);
    console.info(`[live] ${authType} ${siteUrl}`);
    const settings = await client.getSettings();
    expect(typeof settings.title).toBe("string");
    console.info(
      `[live] settings: show_on_front=${settings.show_on_front} page_for_posts=${settings.page_for_posts}`,
    );
    const posts = await client.listObjects("post", 5);
    const pages = await client.listObjects("page", 5);
    console.info(`[live] ${posts.length} post(s), ${pages.length} page(s)`);
    expect(Array.isArray(posts)).toBe(true);
    if (posts[0]) {
      const full = await client.getObject("post", posts[0].id);
      expect(full.id).toBe(posts[0].id);
      expect(full.link).toMatch(/^https:\/\//);
      console.info(`[live] meta keys on post ${full.id}: ${Object.keys(full.meta).join(", ")}`);
    }
  }, 60_000);

  it("fingerprints the live home page as WordPress", async () => {
    const workspaceId = await workspaceWithWordPress();
    if (!workspaceId) return;
    const { clientFor } = await import("@/server/connectors/wordpress/service.server");
    const { siteUrl } = await clientFor(workspaceId);
    const { fetchPublicText } = await import("@/server/safe-fetch");
    const { fingerprintPage } = await import("@/lib/sites/fingerprint");
    const html = await fetchPublicText(`${siteUrl}/`, { timeoutMs: 20_000 });
    const f = fingerprintPage(html);
    console.info(`[live] fingerprint ${JSON.stringify(f.wordpress)}`);
    expect(f.platform).toBe("wordpress");
  }, 60_000);

  (WRITE ? it : it.skip)(
    "applies a reversible change to a post excerpt and restores it",
    async () => {
      const workspaceId = await workspaceWithWordPress();
      if (!workspaceId) return;
      const { clientFor } = await import("@/server/connectors/wordpress/service.server");
      const { client } = await clientFor(workspaceId);
      const [post] = await client.listObjects("post", 1);
      if (!post) {
        console.warn("[live] no published post to change — skipped");
        return;
      }
      const before = await client.getObject("post", post.id);
      const marker = `Mellox live check ${Date.now()}`;
      const changed = await client.updateObject("post", post.id, { excerpt: marker });
      expect(changed.excerpt).toContain(marker);
      const restored = await client.updateObject("post", post.id, { excerpt: before.excerpt });
      expect(restored.excerpt).not.toContain(marker);
    },
    60_000,
  );
});
