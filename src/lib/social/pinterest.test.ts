import { describe, expect, it } from "vitest";
import { pinIssue } from "./pinterest";

const pin = (over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
  kind: "image",
  channel: null,
  media_url: null,
  ...over,
  meta: { platform: "pinterest", asset_storage_path: "ws-1/a.png", ...meta },
});

describe("pinIssue", () => {
  it("lets one picture through", () => {
    expect(pinIssue(pin())).toBeNull();
    expect(
      pinIssue(pin({ media_url: "https://cdn.test/a.png" }, { asset_storage_path: null })),
    ).toBeNull();
  });

  it("ignores other networks", () => {
    expect(pinIssue({ kind: "video", meta: { platform: "instagram" } })).toBeNull();
  });

  it("refuses videos and Stories", () => {
    expect(pinIssue(pin({ kind: "video" }))).toMatch(/Pins are pictures/);
    expect(pinIssue(pin({ kind: "story" }))).toMatch(/Pins are pictures/);
    expect(pinIssue(pin({}, { media_type: "video" }))).toMatch(/Pins are pictures/);
  });

  it("refuses more than one picture", () => {
    expect(pinIssue(pin({ kind: "carousel" }))).toMatch(/one picture/);
    expect(pinIssue(pin({}, { asset_storage_paths: ["ws-1/a.png", "ws-1/b.png"] }))).toMatch(
      /one picture/,
    );
  });

  it("refuses words alone", () => {
    expect(pinIssue(pin({ kind: "post" }, { asset_storage_path: null }))).toMatch(
      /needs a picture/,
    );
  });

  it("reads the platform from the channel too", () => {
    expect(pinIssue({ kind: "post", channel: "pinterest", meta: {} })).toMatch(/needs a picture/);
  });
});
