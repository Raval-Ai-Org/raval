import { describe, expect, it } from "vitest";
import { GENERIC_ERROR, isInternalMessage, messageForStatus, userSafeMessage } from "./user-errors";

describe("userSafeMessage", () => {
  it.each([
    "Insufficient credits on OpenRouter",
    "AI service is not configured. Set OPENROUTER_API_KEY on the server.",
    "KIE out of credits",
    "Network error contacting AI provider: fetch failed",
    "The AI model declined to answer for studio.generate.",
    "duplicate key value violates unique constraint",
    "Request failed with status 502",
  ])("hides %s", (m) => {
    expect(isInternalMessage(m)).toBe(true);
    expect(userSafeMessage(m)).toBe(GENERIC_ERROR);
  });

  it.each([
    "Tell Mellox what this should achieve first.",
    "You don't have access to this workspace",
    "Invalid request: email — Invalid email",
    "Your plan allows 3 workspaces.",
  ])("keeps %s", (m) => {
    expect(userSafeMessage(m)).toBe(m);
  });

  it("maps statuses to plain sentences", () => {
    expect(messageForStatus(429)).toMatch(/busy/);
    expect(messageForStatus(503)).toMatch(/isn't available/);
    expect(messageForStatus(500)).toBe(GENERIC_ERROR);
  });
});
