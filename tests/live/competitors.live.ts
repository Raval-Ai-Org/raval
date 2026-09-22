// competitors.live.ts — opt-in end-to-end checks of the competitor pipeline
// against the real Tavily API and the real Anthropic API.
//
// These exercise the engines directly (discovery → profile → updates) and
// write nothing: no database rows are created, so a run leaves no trace in any
// workspace. They do spend a handful of search credits and a few small Claude
// calls, which is why they are opt-in.
//
//   npx vitest run --config vitest.live.config.ts tests/live/competitors.live.ts
import { beforeAll, describe, expect, it } from "vitest";
import { config } from "dotenv";

config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const ready = Boolean(process.env.TAVILY_API_KEY?.trim() && process.env.ANTHROPIC_API_KEY?.trim());
const describeLive = ready ? describe : describe.skip;

// A real, well-documented business with real competitors and real coverage.
const BUSINESS = {
  brandName: "Notion",
  domain: "notion.so",
  industry: "team workspace and note-taking software",
  oneLiner: "One workspace for notes, docs, tasks and wikis",
  products: "Notes, databases, wikis, project tracking",
  audience: "Startup and small-business teams",
  keywords: ["team wiki", "note taking app"],
  knownDomains: [] as string[],
};

describeLive("competitor pipeline, end to end", () => {
  let discovery: typeof import("@/server/competitors/discovery.server");
  let profile: typeof import("@/server/competitors/profile.server");
  let updates: typeof import("@/server/competitors/updates.server");

  beforeAll(async () => {
    discovery = await import("@/server/competitors/discovery.server");
    profile = await import("@/server/competitors/profile.server");
    updates = await import("@/server/competitors/updates.server");
  });

  it("discovers real competitors from real business context", async () => {
    const result = await discovery.discoverCompetitors(BUSINESS);

    expect(result.queries.length).toBeGreaterThan(0);
    expect(result.sourcesSeen).toBeGreaterThan(0);
    expect(result.suggestions.length).toBeGreaterThan(0);

    for (const suggestion of result.suggestions) {
      // Grounding: never the business itself, never a directory, and always a
      // real domain that a search actually returned.
      expect(suggestion.domain).not.toBe(BUSINESS.domain);
      expect(suggestion.domain).toContain(".");
      expect(suggestion.confidence).toBeGreaterThanOrEqual(0);
      expect(suggestion.confidence).toBeLessThanOrEqual(1);
      expect(["direct", "indirect", "alternative", "unknown"]).toContain(suggestion.relationship);
    }

    // The point of the feature: at least one recognisable competitor, with a
    // reason attached rather than a bare name.
    const explained = result.suggestions.filter((s) => s.rationale.length > 10);
    expect(explained.length).toBeGreaterThan(0);
  }, 180_000);

  it("builds a grounded profile of a real competitor", async () => {
    const built = await profile.buildCompetitorProfile({
      name: "Linear",
      domain: "linear.app",
      url: "https://linear.app",
    });

    expect(built.pagesRead.length).toBeGreaterThan(0);
    expect(["firecrawl", "tavily"]).toContain(built.contentProvider);
    // "Who are they / what do they do" is the question the card must answer.
    expect(built.summary.length).toBeGreaterThan(20);
    expect(built.positioning.length + built.targetCustomers.length).toBeGreaterThan(0);

    // Every piece of evidence must carry a source, and never one we invented.
    for (const item of built.evidence) {
      expect(item.claim.length).toBeGreaterThan(0);
      if (item.source) expect(item.source.startsWith("http")).toBe(true);
    }
    for (const source of built.sources) {
      expect(source.url.startsWith("http")).toBe(true);
      // Third-party coverage only: the competitor's own blog is not coverage.
      expect(new URL(source.url).hostname).not.toContain("linear.app");
    }
  }, 180_000);

  it("finds meaningful recent changes and never repeats one", async () => {
    const first = await updates.detectCompetitorUpdates({
      name: "Linear",
      domain: "linear.app",
      lastCheckedAt: null,
    });

    expect(first.days).toBe(30);
    expect(first.sourcesSeen).toBeGreaterThan(0);

    for (const update of first.updates) {
      expect(update.title.length).toBeGreaterThan(0);
      expect(update.sourceUrl.startsWith("http")).toBe(true);
      expect(["major", "notable"]).toContain(update.significance);
    }

    // Fingerprints must be unique within a sweep...
    const fingerprints = first.updates.map((update) => update.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);

    // ...and a repeat sweep that already knows them must return nothing new.
    const second = await updates.detectCompetitorUpdates({
      name: "Linear",
      domain: "linear.app",
      lastCheckedAt: null,
      knownFingerprints: fingerprints,
    });
    for (const update of second.updates) {
      expect(fingerprints).not.toContain(update.fingerprint);
    }
  }, 180_000);

  it("asks only for the window since the last check on a repeat sweep", async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const result = await updates.detectCompetitorUpdates({
      name: "Linear",
      domain: "linear.app",
      lastCheckedAt: yesterday,
    });
    expect(result.days).toBe(1);
  }, 120_000);
});
