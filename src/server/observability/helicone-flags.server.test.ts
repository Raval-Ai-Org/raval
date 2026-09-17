import { afterEach, describe, expect, it } from "vitest";
import { heliconeEnabled, heliconeLogPromptsEnabled } from "./helicone-flags.server";

afterEach(() => {
  delete process.env.HELICONE_BASE_URL;
  delete process.env.HELICONE_LOG_PROMPTS;
});

describe("heliconeEnabled", () => {
  it("is off by default", () => {
    expect(heliconeEnabled()).toBe(false);
  });

  it("turns on once a base URL is configured", () => {
    process.env.HELICONE_BASE_URL = "http://localhost:8585";
    expect(heliconeEnabled()).toBe(true);
  });

  it("ignores a blank base URL", () => {
    process.env.HELICONE_BASE_URL = "   ";
    expect(heliconeEnabled()).toBe(false);
  });
});

describe("heliconeLogPromptsEnabled", () => {
  it("defaults to false", () => {
    expect(heliconeLogPromptsEnabled()).toBe(false);
  });

  it('turns on only with an explicit "true"', () => {
    process.env.HELICONE_LOG_PROMPTS = "true";
    expect(heliconeLogPromptsEnabled()).toBe(true);
    process.env.HELICONE_LOG_PROMPTS = "yes";
    expect(heliconeLogPromptsEnabled()).toBe(false);
  });
});
