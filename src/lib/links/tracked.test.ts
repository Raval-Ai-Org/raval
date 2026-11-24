import { describe, expect, it } from "vitest";
import { isLinkBot, ownLinks, slugFrom, swapLinks } from "./tracked";

describe("tracked links (Round 9)", () => {
  it("finds only the brand's own https links, once each", () => {
    const text =
      "Book now: https://www.acme.com/book. Menu at https://shop.acme.com/menu, or https://other.com/x and https://www.acme.com/book";
    expect(ownLinks(text, "acme.com")).toEqual([
      "https://www.acme.com/book",
      "https://shop.acme.com/menu",
    ]);
    expect(ownLinks(text, null)).toEqual([]);
    expect(ownLinks("http://acme.com/x", "https://acme.com")).toEqual([]);
    expect(ownLinks("https://notacme.com/x", "acme.com")).toEqual([]);
  });

  it("swaps exact links and keeps the sentence's punctuation", () => {
    const short = new Map([["https://acme.com/book", "https://app.mellox.ai/l/Ab3dEf7h"]]);
    expect(swapLinks("Book at https://acme.com/book. Thanks", short)).toBe(
      "Book at https://app.mellox.ai/l/Ab3dEf7h. Thanks",
    );
    expect(swapLinks("See https://acme.com/other", short)).toBe("See https://acme.com/other");
  });

  it("makes 8-character slugs the database accepts", () => {
    const slug = slugFrom(new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253]));
    expect(slug).toMatch(/^[A-Za-z0-9]{8}$/);
  });

  it("never counts previews and crawlers", () => {
    expect(isLinkBot("facebookexternalhit/1.1")).toBe(true);
    expect(isLinkBot("Twitterbot/1.0")).toBe(true);
    expect(isLinkBot("")).toBe(true);
    expect(
      isLinkBot(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      ),
    ).toBe(false);
  });
});
