// Live run of "add a blog to my site" for a GitHub-built website (reads .env):
//
//   the first workspace whose proven repository has no blog → detection says
//   Mellox can add one (or names why not)
//   BLOG_SETUP_LIVE_AI=yes: read the site, ask the model for the design and
//   write the blog's files in memory. Nothing is written to GitHub.
//
// Opt-in: npx vitest run --config vitest.live.config.ts tests/live/article-blog-setup.live.ts
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

const ready = !!process.env.SUPABASE_SERVICE_ROLE_KEY && !!process.env.GITHUB_APP_ID;
const AI = process.env.BLOG_SETUP_LIVE_AI === "yes";

(ready ? describe : describe.skip)("Adding a blog to a GitHub site (live)", () => {
  it("detects a site without a blog and plans one", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveSite } = await import("@/server/sites/resolve.server");
    const blog = await import("@/server/articles/blog.server");
    const { data: sources } = await supabaseAdmin
      .from("workspace_sources")
      .select("workspace_id, site_host, selected_by")
      .eq("provider", "github")
      .eq("status", "active")
      .not("site_host", "is", null)
      .order("updated_at", { ascending: false })
      .limit(10);
    for (const s of sources ?? []) {
      const binding = (await resolveSite(s.workspace_id, s.site_host!)).binding;
      if (!binding || binding.provider !== "github" || !binding.verified) continue;
      const row = await blog.ensureBlogSettings(s.workspace_id, binding.host, binding, {
        force: true,
      });
      const view = blog.blogView(row);
      console.info(`[live] ${binding.host} · ${binding.fullName} · blog ${view.status}`, view);
      if (view.status !== "missing") continue;
      expect(view.detail).toBeTruthy();
      expect(view.canCreate).toBe(!!row.setup?.framework);
      if (!AI || !view.canCreate || !s.selected_by) return;

      const { planGithubBlog } = await import("@/server/articles/blog-setup.server");
      const planned = await planGithubBlog(
        { workspaceId: s.workspace_id, userId: s.selected_by },
        binding,
      );
      console.info("[live] plan", {
        framework: planned.plan.framework,
        files: planned.files.map((f) => f.path),
        header: planned.chrome.header?.name ?? null,
        footer: planned.chrome.footer?.name ?? null,
        menuLink: planned.menuLink,
        designedByModel: planned.designedByModel,
      });
      expect(planned.files.length).toBeGreaterThanOrEqual(4);
      expect(planned.files.some((f) => f.path === "mellox-blog.json")).toBe(true);
      return;
    }
    console.warn("[live] no proven GitHub site without a blog — skipped");
  }, 240_000);
});
