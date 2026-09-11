import { describe, expect, it } from "vitest";
import { parseRobotsAllow } from "./geo-audit.server";

describe("parseRobotsAllow", () => {
  it("is unknown without a robots.txt", () => {
    expect(parseRobotsAllow("", "GPTBot")).toBe("unknown");
  });

  it("blocks a bot named in a Disallow: / group", () => {
    const robots = "User-agent: GPTBot\nDisallow: /";
    expect(parseRobotsAllow(robots, "GPTBot")).toBe("block");
    expect(parseRobotsAllow(robots, "ClaudeBot")).toBe("allow");
  });

  it("treats consecutive User-agent lines as one group", () => {
    // The old parser kept only the last UA line, so GPTBot read as allowed.
    const robots = "User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /";
    expect(parseRobotsAllow(robots, "GPTBot")).toBe("block");
    expect(parseRobotsAllow(robots, "CCBot")).toBe("block");
  });

  it("does not leak another group's rules onto a bot", () => {
    // The old parser's group flag was sticky, so BadBot's Disallow: / blocked GPTBot.
    const robots = [
      "User-agent: GPTBot",
      "Disallow: /private",
      "",
      "User-agent: BadBot",
      "Disallow: /",
    ].join("\n");
    expect(parseRobotsAllow(robots, "GPTBot")).toBe("allow");
    expect(parseRobotsAllow(robots, "BadBot")).toBe("block");
  });

  it("falls back to the * group when the bot has no group", () => {
    const robots = "User-agent: *\nDisallow: /";
    expect(parseRobotsAllow(robots, "PerplexityBot")).toBe("block");
  });

  it("lets a bot-specific group override a blocking * group", () => {
    const robots = "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /";
    expect(parseRobotsAllow(robots, "GPTBot")).toBe("allow");
    expect(parseRobotsAllow(robots, "CCBot")).toBe("block");
  });

  it("matches user-agent tokens case-insensitively and ignores comments", () => {
    const robots = "user-agent: gptbot # OpenAI\ndisallow: / # everything";
    expect(parseRobotsAllow(robots, "GPTBot")).toBe("block");
  });

  it("treats an empty Disallow as allow-all", () => {
    expect(parseRobotsAllow("User-agent: *\nDisallow:", "GPTBot")).toBe("allow");
  });

  it("allows when Allow: / sits alongside Disallow: /", () => {
    expect(parseRobotsAllow("User-agent: GPTBot\nDisallow: /\nAllow: /", "GPTBot")).toBe("allow");
  });
});
