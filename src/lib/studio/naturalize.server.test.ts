import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialVariant } from "@/lib/studio/jobs";

const state = vi.hoisted(() => ({
  response: null as { rewritten: string } | null,
  shouldThrow: false,
  calls: [] as { system: string; user: string }[],
}));

vi.mock("@/lib/anthropic-gateway.server", () => ({
  claudeJsonPrompt: vi.fn(async (opts: { system: string; user: string; fallback: unknown }) => {
    state.calls.push({ system: opts.system, user: opts.user });
    if (state.shouldThrow) throw new Error("gateway unavailable");
    return state.response ?? opts.fallback;
  }),
}));

const { naturalizeVariant, naturalizeVariants } = await import("./naturalize.server");

function variant(body: string): SocialVariant {
  return { platform: "instagram", title: "Post", body, hashtags: ["#sale"], chars: body.length };
}

const brand = { brandName: "Acme", brandText: "Confident, plain-spoken, never salesy." };

describe("naturalizeVariant", () => {
  beforeEach(() => {
    state.response = null;
    state.shouldThrow = false;
    state.calls = [];
  });

  it("skips the gateway entirely for a caption that already reads fine", async () => {
    const original = variant(
      "Our Q3 pricing update goes live Monday. Details at mellox.ai/pricing.",
    );
    const result = await naturalizeVariant(original, brand);
    expect(result).toBe(original);
    expect(state.calls).toHaveLength(0);
  });

  it("replaces a cliché-heavy caption with a validated rewrite", async () => {
    const original = variant(
      "In today's fast-paced digital world, unlock your potential and elevate your brand! #sale",
    );
    state.response = {
      rewritten: "Our new dashboard shows exactly where your campaigns are working. #sale",
    };
    const result = await naturalizeVariant(original, brand);
    expect(result.body).toContain("dashboard");
    expect(result.body).not.toBe(original.body);
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].system).toContain("Acme");
    expect(state.calls[0].user).toBe(original.body);
  });

  it("keeps the original when the rewrite drops a protected hashtag/URL", async () => {
    const original = variant(
      "In today's fast-paced digital world, unlock your potential — visit https://mellox.ai/go now! #sale",
    );
    state.response = { rewritten: "Check out what we built for you." };
    const result = await naturalizeVariant(original, brand);
    expect(result).toBe(original);
  });

  it("keeps the original when the gateway throws", async () => {
    const original = variant(
      "In today's fast-paced digital world, unlock your potential and elevate your brand!",
    );
    state.shouldThrow = true;
    const result = await naturalizeVariant(original, brand);
    expect(result).toBe(original);
  });

  it("keeps the original when the model returns an empty rewrite", async () => {
    const original = variant(
      "In today's fast-paced digital world, unlock your potential and elevate your brand!",
    );
    state.response = { rewritten: "   " };
    const result = await naturalizeVariant(original, brand);
    expect(result).toBe(original);
  });
});

describe("naturalizeVariants", () => {
  beforeEach(() => {
    state.response = null;
    state.shouldThrow = false;
    state.calls = [];
  });

  it("passes through undefined/empty without calling the gateway", async () => {
    expect(await naturalizeVariants(undefined, brand)).toBeUndefined();
    expect(await naturalizeVariants([], brand)).toEqual([]);
    expect(state.calls).toHaveLength(0);
  });

  it("processes each variant independently", async () => {
    const clean = variant("Our Q3 pricing update goes live Monday at mellox.ai/pricing.");
    const clichey = variant(
      "Unlock your potential and elevate your brand in today's fast-paced world!",
    );
    state.response = { rewritten: "We shipped three fixes this week that customers asked for." };
    const result = await naturalizeVariants([clean, clichey], brand);
    expect(result?.[0]).toBe(clean);
    expect(result?.[1].body).toContain("shipped");
  });
});
