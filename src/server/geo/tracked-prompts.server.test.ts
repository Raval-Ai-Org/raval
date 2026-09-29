import { describe, expect, it } from "vitest";
import {
  mentionPosition,
  modelForEngine,
  nextCheckAfter,
  weeklyTrend,
} from "./tracked-prompts.server";

describe("tracked prompts", () => {
  const models = ["perplexity/sonar", "openai/gpt-5.6-luna", "google/gemini-3.8-flash"];

  it("asks each plan engine its own configured model", () => {
    expect(modelForEngine("perplexity", models)).toBe("perplexity/sonar");
    expect(modelForEngine("chatgpt", models)).toBe("openai/gpt-5.6-luna");
    expect(modelForEngine("gemini", models)).toBe("google/gemini-3.8-flash");
    expect(modelForEngine("google_aio", models)).toBeNull();
    expect(modelForEngine("chatgpt", ["perplexity/sonar"])).toBeNull();
  });

  it("checks again a week later", () => {
    expect(nextCheckAfter(new Date("2026-10-01T00:00:00Z")).toISOString()).toBe(
      "2026-10-08T00:00:00.000Z",
    );
  });

  it("ranks where the brand appears in a list answer", () => {
    const answer = "Top picks:\n1. HubSpot\n2. Pipedrive\n3. Acme CRM (acme.io)";
    expect(mentionPosition(answer, "Acme CRM", "acme.io")).toBe(3);
    expect(mentionPosition("Acme CRM is a good choice.", "Acme CRM", "acme.io")).toBe(1);
    expect(mentionPosition("Try HubSpot.", "Acme CRM", "acme.io")).toBeNull();
  });

  it("builds a weekly mention rate, oldest first", () => {
    const now = new Date("2026-10-29T00:00:00Z");
    const day = 86_400_000;
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * day).toISOString();
    const trend = weeklyTrend(
      [
        { checked_at: at(1), mentioned: true },
        { checked_at: at(2), mentioned: false },
        { checked_at: at(9), mentioned: false },
        { checked_at: at(60), mentioned: true },
      ],
      6,
      now,
    );
    expect(trend).toHaveLength(2);
    expect(trend[0].rate).toBe(0);
    expect(trend[1].rate).toBe(0.5);
  });
});
