import { describe, expect, it } from "vitest";
import { articleRicos, ricosText, type RicosNode } from "./wix-ricos";
import type { PublishableArticle } from "./render";

const article: PublishableArticle = {
  title: "How to forge an anvil",
  dek: "A short guide.",
  metaDescription: "Forge an anvil step by step.",
  takeaways: ["Heat evenly", "Quench slowly"],
  markdown: [
    "# How to forge an anvil",
    "",
    "Start with **good steel** and a [hot forge](https://example.com/forge).",
    "",
    "## Tools",
    "",
    "- Hammer",
    "- Tongs",
    "",
    "1. Heat",
    "2. Strike",
    "",
    "> Measure twice.",
    "",
    "Bad [link](javascript:alert(1)) here.",
  ].join("\n"),
  faq: [{ question: "How long does it take?", answer: "About a day." }],
  slug: "how-to-forge-an-anvil",
  category: null,
  tags: [],
};

const types = (nodes: RicosNode[]) => nodes.map((n) => n.type);

describe("articleRicos", () => {
  const doc = articleRicos(article);

  it("lays out takeaways, the body and the FAQ like the HTML renderer", () => {
    expect(types(doc.nodes)).toEqual([
      "HEADING",
      "BULLETED_LIST",
      "PARAGRAPH",
      "HEADING",
      "BULLETED_LIST",
      "ORDERED_LIST",
      "BLOCKQUOTE",
      "PARAGRAPH",
      "HEADING",
      "HEADING",
      "PARAGRAPH",
    ]);
    expect(doc.nodes[3].headingData).toEqual({ level: 2 });
    expect(doc.nodes[9].headingData).toEqual({ level: 3 });
  });

  it("drops the markdown title (the post's title is the page heading)", () => {
    expect(ricosText(doc)).not.toContain("How to forge an anvil");
  });

  it("keeps bold and web links as decorations", () => {
    const texts = doc.nodes[2].nodes;
    expect(texts.find((t) => t.textData?.text === "good steel")?.textData?.decorations).toEqual([
      { type: "BOLD", fontWeightValue: 700 },
    ]);
    expect(texts.find((t) => t.textData?.text === "hot forge")?.textData?.decorations).toEqual([
      { type: "LINK", linkData: { link: { url: "https://example.com/forge", target: "BLANK" } } },
    ]);
  });

  it("turns an unsafe link into plain text", () => {
    const bad = doc.nodes[7].nodes.find((t) => t.textData?.text === "link");
    expect(bad?.textData?.decorations).toEqual([]);
  });

  it("gives every block node a unique id", () => {
    const ids: string[] = [];
    const walk = (ns: RicosNode[]) =>
      ns.forEach((n) => {
        if (n.type !== "TEXT") ids.push(n.id);
        walk(n.nodes);
      });
    walk(doc.nodes);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
