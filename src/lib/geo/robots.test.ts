import { describe, expect, it } from "vitest";
import {
  crawlDelayFor,
  isPathAllowed,
  parseRobotsAllow,
  robotsSitemaps,
  summarizeEngines,
} from "./robots";

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
    const robots = "User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /";
    expect(parseRobotsAllow(robots, "GPTBot")).toBe("block");
    expect(parseRobotsAllow(robots, "CCBot")).toBe("block");
  });

  it("does not leak another group's rules onto a bot", () => {
    const robots = "User-agent: GPTBot\nDisallow: /private\n\nUser-agent: BadBot\nDisallow: /";
    expect(parseRobotsAllow(robots, "GPTBot")).toBe("allow");
    expect(parseRobotsAllow(robots, "BadBot")).toBe("block");
  });

  it("falls back to the * group and lets a specific group override it", () => {
    const robots = "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /";
    expect(parseRobotsAllow(robots, "GPTBot")).toBe("allow");
    expect(parseRobotsAllow(robots, "CCBot")).toBe("block");
  });

  it("matches tokens case-insensitively, ignores comments, and treats empty Disallow as allow", () => {
    expect(parseRobotsAllow("user-agent: gptbot # OpenAI\ndisallow: / # all", "GPTBot")).toBe(
      "block",
    );
    expect(parseRobotsAllow("User-agent: *\nDisallow:", "GPTBot")).toBe("allow");
    expect(parseRobotsAllow("User-agent: GPTBot\nDisallow: /\nAllow: /", "GPTBot")).toBe("allow");
  });
});

describe("summarizeEngines", () => {
  it("reports unknown without robots.txt, partial when some crawlers are blocked", () => {
    expect(summarizeEngines("").every((e) => e.state === "unknown")).toBe(true);
    const engines = summarizeEngines("User-agent: GPTBot\nDisallow: /");
    expect(engines.find((e) => e.id === "chatgpt")).toMatchObject({
      state: "partial",
      blocked: ["GPTBot"],
    });
    expect(engines.find((e) => e.id === "claude")!.state).toBe("open");
  });

  it("marks every engine blocked behind a wildcard Disallow: /", () => {
    expect(summarizeEngines("User-agent: *\nDisallow: /").every((e) => e.state === "blocked")).toBe(
      true,
    );
  });
});

describe("isPathAllowed (RFC 9309)", () => {
  const robots = [
    "User-agent: *",
    "Disallow: /private",
    "Allow: /private/press",
    "Disallow: /*.pdf$",
    "Disallow: /search?",
    "",
    "User-agent: MelloxAI-Audit",
    "Disallow: /staging/",
  ].join("\n");

  it("uses the crawler's own group when one exists", () => {
    expect(isPathAllowed(robots, "MelloxAI-Audit", "/private/x")).toBe(true);
    expect(isPathAllowed(robots, "MelloxAI-Audit", "/staging/page")).toBe(false);
  });

  it("applies the longest matching rule, with wildcards and end anchors", () => {
    expect(isPathAllowed(robots, "OtherBot", "/private/secret")).toBe(false);
    expect(isPathAllowed(robots, "OtherBot", "/private/press/2026")).toBe(true);
    expect(isPathAllowed(robots, "OtherBot", "/files/report.pdf")).toBe(false);
    expect(isPathAllowed(robots, "OtherBot", "/files/report.pdf?x=1")).toBe(true);
    expect(isPathAllowed(robots, "OtherBot", "/search?q=a")).toBe(false);
    expect(isPathAllowed(robots, "OtherBot", "/about")).toBe(true);
  });

  it("allows everything without robots.txt or a matching group", () => {
    expect(isPathAllowed("", "X", "/anything")).toBe(true);
    expect(isPathAllowed("User-agent: GPTBot\nDisallow: /", "X", "/")).toBe(true);
  });

  it("resolves an equal-length Allow/Disallow tie to allow", () => {
    expect(isPathAllowed("User-agent: *\nDisallow: /a\nAllow: /a", "X", "/a")).toBe(true);
  });
});

describe("robots helpers", () => {
  it("collects declared sitemaps and crawl delays", () => {
    const robots =
      "User-agent: *\nCrawl-delay: 3\nSitemap: https://a.io/s1.xml\nsitemap: https://a.io/s2.xml";
    expect(robotsSitemaps(robots)).toEqual(["https://a.io/s1.xml", "https://a.io/s2.xml"]);
    expect(crawlDelayFor(robots, "MelloxAI-Audit")).toBe(3);
    expect(crawlDelayFor("", "X")).toBeNull();
  });
});
