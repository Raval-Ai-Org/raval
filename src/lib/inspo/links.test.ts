import { describe, expect, it } from "vitest";
import { isReelLink, pickReelFormat } from "./links";

describe("isReelLink", () => {
  it("accepts https Instagram, TikTok and YouTube links", () => {
    expect(isReelLink("https://www.instagram.com/reel/abc/")).toBe(true);
    expect(isReelLink("https://vm.tiktok.com/ZM123/")).toBe(true);
    expect(isReelLink("https://m.youtube.com/shorts/xyz")).toBe(true);
    expect(isReelLink(" https://youtu.be/xyz ")).toBe(true);
  });

  it("refuses other hosts, http, ports and credentials", () => {
    expect(isReelLink("https://example.com/video.mp4")).toBe(false);
    expect(isReelLink("http://instagram.com/reel/abc")).toBe(false);
    expect(isReelLink("https://instagram.com:8443/reel/abc")).toBe(false);
    expect(isReelLink("https://user:pw@tiktok.com/@a/video/1")).toBe(false);
    expect(isReelLink("https://evil-instagram.com/reel/abc")).toBe(false);
    expect(isReelLink("not a link")).toBe(false);
  });
});

describe("pickReelFormat", () => {
  const mp4 = (over: Record<string, unknown>) => ({
    url: "https://cdn.example/v.mp4",
    ext: "mp4",
    protocol: "https",
    vcodec: "avc1",
    acodec: "mp4a",
    ...over,
  });

  it("picks the sharpest MP4 with sound up to 1080p", () => {
    const pick = pickReelFormat({
      title: "  My   reel ",
      duration: 30,
      formats: [
        mp4({ url: "https://cdn.example/720.mp4", width: 720, height: 1280 }),
        mp4({ url: "https://cdn.example/1080.mp4", width: 1080, height: 1920 }),
        mp4({ url: "https://cdn.example/4k.mp4", width: 2160, height: 3840 }),
        mp4({
          url: "https://cdn.example/mute.mp4",
          width: 1080,
          height: 1920,
          acodec: "none",
          tbr: 50,
        }),
        mp4({
          url: "https://cdn.example/hls.m3u8",
          protocol: "m3u8_native",
          width: 1080,
          height: 1920,
        }),
      ],
    });
    expect(pick?.url).toBe("https://cdn.example/1080.mp4");
    expect(pick?.height).toBe(1080);
    expect(pick?.title).toBe("My reel");
  });

  it("keeps only ordinary request headers", () => {
    const pick = pickReelFormat({
      duration: 10,
      formats: [mp4({ http_headers: { "User-Agent": "x", Cookie: "secret", Referer: "r" } })],
    });
    expect(pick?.headers).toEqual({ "User-Agent": "x", Referer: "r" });
  });

  it("refuses live videos, videos over three minutes and plain http files", () => {
    expect(pickReelFormat({ is_live: true, formats: [mp4({})] })).toBeNull();
    expect(pickReelFormat({ duration: 200, formats: [mp4({})] })).toBeNull();
    expect(
      pickReelFormat({ duration: 10, formats: [mp4({ url: "http://cdn.example/v.mp4" })] }),
    ).toBeNull();
  });
});
