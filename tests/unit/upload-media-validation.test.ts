import { describe, it, expect } from "vitest";
import { matchesMediaType } from "@/server/assets/upload-validation";

describe("user upload container validation", () => {
  it("accepts supported signatures and rejects HTML disguised as an image or video", () => {
    expect(matchesMediaType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png")).toBe(
      true,
    );
    expect(matchesMediaType(Buffer.from([255, 216, 255]), "image/jpeg")).toBe(true);
    expect(matchesMediaType(Buffer.from("RIFF0000WEBP"), "image/webp")).toBe(true);
    expect(matchesMediaType(Buffer.from("0000ftypisom"), "video/mp4")).toBe(true);
    expect(matchesMediaType(Buffer.from([26, 69, 223, 163]), "video/webm")).toBe(true);
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "video/mp4",
      "video/quicktime",
      "video/webm",
      "image/svg+xml",
    ])
      expect(matchesMediaType(Buffer.from("<script>alert(1)</script>"), type)).toBe(false);
  });
});
