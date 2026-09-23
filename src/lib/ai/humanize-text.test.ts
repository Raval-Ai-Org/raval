import { describe, expect, it } from "vitest";
import { humanizeDeep, humanizeText } from "./humanize-text";

describe("humanizeText", () => {
  it("converts a clause-break em dash to a comma", () => {
    expect(humanizeText("not charity — quality control")).toBe("not charity, quality control");
  });

  it("leaves plain text with no dash untouched", () => {
    const text = "Ship the update Monday. No blockers.";
    expect(humanizeText(text)).toBe(text);
  });

  it("keeps digit ranges as hyphenated, not comma'd", () => {
    expect(humanizeText("open 9—5 daily")).toBe("open 9-5 daily");
  });
});

describe("humanizeDeep", () => {
  it("cleans string values at every depth of a nested structure", () => {
    const input = {
      title: "Big news — for real this time",
      variants: [
        { body: "Save 20% — today only", hashtags: ["#sale"] },
        { body: "No dash here", hashtags: [] },
      ],
    };
    const out = humanizeDeep(input);
    expect(out.title).toBe("Big news, for real this time");
    expect(out.variants[0].body).toBe("Save 20%, today only");
    expect(out.variants[1].body).toBe("No dash here");
  });

  it("skips known non-prose keys (url, href, id, ...) so links/ids stay byte-exact", () => {
    const input = {
      description: "Read more — it's worth it",
      url: "https://example.com/a—b",
      id: "id—with—dash",
    };
    const out = humanizeDeep(input);
    expect(out.description).toBe("Read more, it's worth it");
    expect(out.url).toBe("https://example.com/a—b");
    expect(out.id).toBe("id—with—dash");
  });

  it("passes through non-string primitives unchanged", () => {
    expect(humanizeDeep(42)).toBe(42);
    expect(humanizeDeep(true)).toBe(true);
    expect(humanizeDeep(null)).toBe(null);
  });
});
