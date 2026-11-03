import { describe, expect, it } from "vitest";
import { connectablePlatforms, routeSocialPlatform } from "./routing";

const ready = { composioReady: true, testing: true };

describe("routeSocialPlatform", () => {
  it("keeps X, Threads and TikTok on Post for Me", () => {
    for (const p of ["twitter", "threads", "tiktok"]) {
      expect(routeSocialPlatform(p, ready).provider).toBe("postforme");
    }
  });

  it("sends every network Composio signs in to without our own app to Composio", () => {
    for (const p of ["instagram", "facebook", "pinterest", "linkedin", "youtube"]) {
      expect(routeSocialPlatform(p, ready).provider).toBe("composio");
    }
  });

  it("falls back to Post for Me while Composio is off or the app is still being tested", () => {
    expect(routeSocialPlatform("instagram", { composioReady: false, testing: true }).provider).toBe(
      "postforme",
    );
    expect(routeSocialPlatform("instagram", { composioReady: true, testing: false }).provider).toBe(
      "postforme",
    );
  });
});

describe("connectablePlatforms", () => {
  const postForMe = ["linkedin", "instagram", "facebook", "youtube"] as const;

  it("adds Pinterest once it connects through Composio", () => {
    expect(connectablePlatforms(postForMe, ready)).toEqual([...postForMe, "pinterest"]);
  });

  it("leaves Pinterest out while Composio can't connect it", () => {
    expect(connectablePlatforms(postForMe, { composioReady: false, testing: true })).toEqual([
      ...postForMe,
    ]);
    expect(connectablePlatforms(postForMe, { composioReady: true, testing: false })).toEqual([
      ...postForMe,
    ]);
  });
});
