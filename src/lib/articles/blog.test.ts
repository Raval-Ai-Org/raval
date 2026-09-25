import { describe, expect, it } from "vitest";
import {
  detectGithubBlog,
  frontmatterKeys,
  githubPostFile,
  pickWebflowBlogCollection,
  webflowItemUrl,
} from "./blog";
import type { PublishableArticle } from "./render";

const article: PublishableArticle = {
  title: 'Choosing a CRM: a "small team" guide',
  dek: "",
  metaDescription: "What matters when a small team picks a CRM.",
  takeaways: ["Start from your process."],
  markdown: "# Dropped H1\n\nIntro.\n\n## Section\n\nText.",
  faq: [{ question: "Is it expensive?", answer: "Most have a free tier." }],
  slug: "choosing-a-crm",
  category: "Sales",
  tags: ["crm"],
};

describe("Webflow blog collection", () => {
  const blog = {
    id: "c1",
    slug: "blog",
    displayName: "Blog Posts",
    fields: [
      { slug: "name", type: "PlainText", isRequired: true },
      { slug: "slug", type: "PlainText", isRequired: true },
      { slug: "post-body", type: "RichText" },
      { slug: "post-summary", type: "PlainText" },
      { slug: "main-image", type: "Image" },
    ],
  };
  const team = {
    id: "c2",
    slug: "team",
    displayName: "Team",
    fields: [{ slug: "bio", type: "RichText" }],
  };

  it("picks the blog and maps its fields", () => {
    const r = pickWebflowBlogCollection([team, blog]);
    expect(r?.collection.id).toBe("c1");
    expect(r?.map).toMatchObject({ body: "post-body", summary: "post-summary", unfillable: [] });
  });

  it("refuses a blog with a required field Mellox can't fill", () => {
    const strict = {
      ...blog,
      fields: [
        ...blog.fields,
        { slug: "author", type: "Reference", isRequired: true, displayName: "Author" },
      ],
    };
    expect(pickWebflowBlogCollection([strict, team])).toBeNull();
  });

  it("builds item URLs", () => {
    expect(webflowItemUrl("https://acme.com/", "blog", "x")).toBe("https://acme.com/blog/x");
  });
});

describe("GitHub blog layout", () => {
  it("finds the folder most posts live in", () => {
    const layout = detectGithubBlog([
      "README.md",
      "src/content/blog/a.mdx",
      "src/content/blog/b.mdx",
      "src/content/blog/c.md",
      "docs/guide.md",
      "posts/old.md",
    ]);
    expect(layout).toMatchObject({
      contentDir: "src/content/blog",
      format: "mdx",
      routePrefix: "/blog",
    });
    expect(detectGithubBlog(["README.md", "src/app/page.tsx"])).toBeNull();
  });

  it("writes a post with only the keys its neighbours use", () => {
    const keys = frontmatterKeys(
      `---\ntitle: X\npubDate: 2024-01-01\ndescription: y\ntags: [a]\n---\nbody`,
    );
    expect(keys).toEqual(["title", "pubDate", "description", "tags"]);
    const file = githubPostFile(
      article,
      { contentDir: "src/content/blog", format: "md" },
      keys,
      "2026-09-24T10:00:00Z",
    );
    expect(file.path).toBe("src/content/blog/choosing-a-crm.md");
    expect(file.content).toContain('title: "Choosing a CRM: a \\"small team\\" guide"');
    expect(file.content).toContain('pubDate: "2026-09-24"');
    expect(file.content).not.toContain("category:");
    expect(file.content).not.toContain("Dropped H1");
    expect(file.content).toMatch(/## Frequently asked questions\n\n### Is it expensive\?/);
  });
});
