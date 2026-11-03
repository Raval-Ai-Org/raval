import { describe, expect, it } from "vitest";
import {
  driveFileName,
  gmailDraftArgs,
  googleAdsAdArgs,
  googleAdsAdGroupArgs,
  googleAdsCampaignArgs,
  readCustomerIds,
  readDriveId,
  readGmailDraftId,
  readResourceName,
  rsaText,
} from "./business";

describe("Google Drive", () => {
  it("names files from the post's title, numbered when there are several", () => {
    expect(driveFileName("Fall: reset/kit", 0, 1, "ws/a/img.png")).toBe("Fall reset kit.png");
    expect(driveFileName("Slides", 1, 3, "ws/a/2.jpg")).toBe("Slides (2 of 3).jpg");
    expect(driveFileName("", 0, 1, "ws/a/clip.mp4")).toBe("Mellox post.mp4");
  });

  it("reads a folder id from a find or create result", () => {
    expect(readDriveId({ data: { folders: [{ id: "F1" }] } })).toBe("F1");
    expect(readDriveId({ id: "F2" })).toBe("F2");
    expect(readDriveId({ data: { folders: [] } })).toBeNull();
  });
});

describe("Gmail", () => {
  it("makes a draft with no recipient, never a send", () => {
    expect(gmailDraftArgs("Hi", "<p>x</p>")).toEqual({
      user_id: "me",
      subject: "Hi",
      body: "<p>x</p>",
      is_html: true,
    });
  });

  it("reads the draft id at either level", () => {
    expect(readGmailDraftId({ data: { id: "r1" } })).toBe("r1");
    expect(readGmailDraftId({ draft: { id: "r2" } })).toBe("r2");
    expect(readGmailDraftId({})).toBeNull();
  });
});

describe("Google Ads", () => {
  const ads = [
    {
      headline: "Calm skin in 7 days",
      primaryText: "Gentle oil for breakouts. Made for sensitive skin.",
      description: "Try the Meltdown Acne Oil today.",
    },
  ];

  it("fits the ad's own words into Google's limits, all distinct", () => {
    const text = rsaText(ads, "Blume")!;
    expect(text.headlines.length).toBeGreaterThanOrEqual(3);
    expect(text.descriptions.length).toBeGreaterThanOrEqual(2);
    for (const h of text.headlines) expect(h.length).toBeLessThanOrEqual(30);
    for (const d of text.descriptions) expect(d.length).toBeLessThanOrEqual(90);
    expect(new Set(text.headlines.map((h) => h.toLowerCase())).size).toBe(text.headlines.length);
  });

  it("refuses an ad too thin for a responsive search ad", () => {
    expect(rsaText([{ headline: "Hi", primaryText: "", description: "" }], "")).toBeNull();
  });

  it("creates every part paused, and never sends a status that runs", () => {
    const json = JSON.stringify([
      googleAdsCampaignArgs("123", "c", "customers/123/campaignBudgets/9"),
      googleAdsAdGroupArgs("123", "g", "customers/123/campaigns/8"),
      googleAdsAdArgs(
        "123",
        "customers/123/adGroups/7",
        { headlines: ["a"], descriptions: ["b"] },
        "https://x.co",
      ),
    ]);
    expect(json).not.toMatch(/"status":"(ENABLED|enabled)"/);
    expect(json.match(/"status":"(PAUSED|paused)"/g)).toHaveLength(3);
    expect(json).not.toMatch(/"remove"|"update"/);
  });

  it("reads customer ids and resource names from results", () => {
    expect(
      readCustomerIds({ resource_names: ["customers/1234567890", "customers/5550001111"] }),
    ).toEqual(["1234567890", "5550001111"]);
    expect(
      readResourceName(
        { results: [{ resource_name: "customers/123/campaignBudgets/456" }] },
        "campaignBudgets",
      ),
    ).toBe("customers/123/campaignBudgets/456");
    expect(readResourceName({}, "campaigns")).toBeNull();
  });
});
