import { describe, expect, it } from "vitest";
import { validCanvaDownloadUrl } from "./download-url";

describe("Canva export URL boundary", () => {
  it("accepts HTTPS Canva export hosts with signed query strings", () => {
    expect(validCanvaDownloadUrl("https://export-download.canva.com/path?token=opaque")).toBe(true);
  });

  it.each([
    "http://export-download.canva.com/file",
    "https://canva.com.evil.test/file",
    "https://127.0.0.1/file",
    "https://user:password@export-download.canva.com/file",
    "invalid-url",
  ])("rejects unsafe export URL %s", (url) => {
    expect(validCanvaDownloadUrl(url)).toBe(false);
  });
});
