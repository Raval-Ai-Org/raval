import { describe, expect, it } from "vitest";
import { connectablePlatforms, routeSocialPlatform } from "./routing";

const ready = { composioReady: true, testing: true };

describe("routeSocialPlatform", () => {
  it("keeps X, Threads and TikTok on Post for Me", () => {
    for (const p of ["twitter", "threads", "tiktok"]) {
      expect(routeSocialPlatform(p, ready).provider).toBe("postforme");
    }
  });

  it("puts every network Post for Me serves on Post for Me first", () => {
    for (const p of ["instagram", "facebook", "linkedin", "youtube"]) {
      expect(routeSocialPlatform(p, ready).provider).toBe("postforme");
    }
  });

  it("uses the backup only for Pinterest, or while Post for Me is down", () => {
    expect(routeSocialPlatform("pinterest", ready).provider).toBe("composio");
    const down = { ...ready, postForMeReady: false };
    for (const p of ["instagram", "facebook", "pinterest", "linkedin", "youtube"]) {
      expect(routeSocialPlatform(p, down).provider).toBe("composio");
    }
    // X, Threads and TikTok have no backup: they stay put.
    expect(routeSocialPlatform("threads", down).provider).toBe("postforme");
  });

  it("keeps Post for Me while the backup is off or the app is still being tested", () => {
    const down = { postForMeReady: false };
    expect(
      routeSocialPlatform("instagram", { ...down, composioReady: false, testing: true }).provider,
    ).toBe("postforme");
    expect(
      routeSocialPlatform("instagram", { ...down, composioReady: true, testing: false }).provider,
    ).toBe("postforme");
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
