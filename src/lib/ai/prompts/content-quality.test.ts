import { describe, expect, it } from "vitest";
import { contentBatchPrompt, regeneratePrompt } from "./library";

describe("format-aware content prompts", () => {
  it("does not impose the social character cap on a mixed batch with a blog", () => {
    const prompt = contentBatchPrompt({
      agent: "spark",
      count: 2,
      channels: ["instagram", "blog"],
      kinds: ["post", "blog"],
    });
    expect(prompt.system).toContain("blog articles are substantive");
    expect(prompt.system).toContain("at least 250 words");
  });

  it("uses an article editor for blog regeneration", () => {
    const prompt = regeneratePrompt({
      channel: "blog",
      kind: "blog",
      title: "Guide",
      body: "Body",
    });
    expect(prompt.system).toContain("blog editor");
    expect(prompt.system).toContain("H2 sections");
  });
});
