import { describe, expect, it } from "vitest";
import { finishEngageReply, sendableReply } from "./reply";
import { fbCommentRows, igCommentRows } from "./sync";

const NOW = Date.parse("2026-11-25T12:00:00Z");

describe("finishEngageReply", () => {
  it("drops a sentence with a figure the brand never gave", () => {
    const out = finishEngageReply("Thanks so much! We ship in 2 days. Come say hi.", {
      platform: "instagram",
      brandDomain: "mellox.ai",
      facts: "We make marketing posts.",
    });
    expect(out.text).not.toContain("2 days");
    expect(out.removed).toBe(1);
  });

  it("keeps the brand's own link and removes others", () => {
    const out = finishEngageReply("See https://mellox.ai/pricing or https://evil.example/x", {
      platform: "facebook",
      brandDomain: "mellox.ai",
      facts: "",
    });
    expect(out.text).toContain("https://mellox.ai/pricing");
    expect(out.text).not.toContain("evil.example");
  });

  it("strips wrapping quotes", () => {
    expect(
      finishEngageReply('"Thank you!"', { platform: "instagram", brandDomain: null, facts: "" })
        .text,
    ).toBe("Thank you!");
  });
});

describe("sendableReply", () => {
  it("refuses blank, too long and foreign links", () => {
    expect(sendableReply("  ", "instagram", null).ok).toBe(false);
    expect(sendableReply("a".repeat(2_201), "instagram", null).ok).toBe(false);
    expect(sendableReply("look https://other.com", "facebook", "mellox.ai").ok).toBe(false);
    expect(sendableReply("Thanks! https://www.mellox.ai", "facebook", "mellox.ai")).toEqual({
      ok: true,
      text: "Thanks! https://www.mellox.ai",
    });
  });
});

describe("comment rows", () => {
  it("keeps other people's recent Instagram comments only", () => {
    const rows = igCommentRows(
      { id: "1790", caption: "New drop", permalink: "https://www.instagram.com/p/x/" },
      [
        { id: "1", text: "Love it", timestamp: "2026-11-24T10:00:00+0000", username: "fan" },
        { id: "2", text: "Our post", timestamp: "2026-11-24T10:00:00+0000", username: "Brand" },
        {
          id: "3",
          text: "Answered",
          timestamp: "2026-11-24T10:00:00+0000",
          username: "fan2",
          replies: { data: [{ id: "4", username: "brand" }] },
        },
        { id: "5", text: "Old", timestamp: "2026-09-01T10:00:00+0000", username: "fan3" },
        { id: "6", text: "", timestamp: "2026-11-24T10:00:00+0000", username: "fan4" },
      ],
      { igUserId: "999", igUsername: "brand" },
      NOW,
    );
    expect(rows.map((r) => r.external_id)).toEqual(["1"]);
    expect(rows[0]).toMatchObject({ platform: "instagram", author_name: "fan", post_id: "1790" });
  });

  it("skips the Page's own Facebook comments and ones it answered", () => {
    const rows = fbCommentRows(
      { id: "10_20", message: "Hello", permalink_url: "http://insecure.example" },
      [
        {
          id: "20_1",
          message: "Price?",
          created_time: "2026-11-25T09:00:00+0000",
          from: { id: "7", name: "Ann" },
        },
        { id: "20_2", message: "Us", created_time: "2026-11-25T09:00:00+0000", from: { id: "10" } },
        {
          id: "20_3",
          message: "Done",
          created_time: "2026-11-25T09:00:00+0000",
          comments: { data: [{ id: "20_4", from: { id: "10" } }] },
        },
      ],
      { pageId: "10" },
      NOW,
    );
    expect(rows.map((r) => r.external_id)).toEqual(["20_1"]);
    expect(rows[0].post_permalink).toBeNull();
    expect(rows[0].author_name).toBe("Ann");
  });
});
