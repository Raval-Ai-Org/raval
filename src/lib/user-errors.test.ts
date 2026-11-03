import { describe, expect, it } from "vitest";
import {
  GENERIC_ERROR,
  UNAVAILABLE_ERROR,
  isInternalMessage,
  messageForFailure,
  messageForStatus,
  userSafeMessage,
} from "./user-errors";

describe("userSafeMessage", () => {
  it.each([
    "Insufficient credits on OpenRouter",
    "AI service is not configured. Set OPENROUTER_API_KEY on the server.",
    "KIE out of credits",
    "Network error contacting AI provider: fetch failed",
    "The AI model declined to answer for studio.generate.",
    "duplicate key value violates unique constraint",
    "Request failed with status 502",
    "OpenRouter is out of credits. Add credits in OpenRouter (openrouter.ai/settings/credits), then retry.",
    "browserType.launch: Target page, context or browser has been closed Browser logs: <launching> /usr/bin/chromium",
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

  it("maps supplier failures without naming anyone", () => {
    expect(messageForFailure(402, "insufficient_credits")).toBe(UNAVAILABLE_ERROR);
    expect(messageForFailure(401, "invalid_api_key")).toBe(UNAVAILABLE_ERROR);
    expect(messageForFailure(402)).toBe(UNAVAILABLE_ERROR);
    expect(messageForFailure(429, "rate_limited")).toMatch(/busy/);
    expect(messageForFailure(504, "timeout")).toMatch(/longer/);
    expect(messageForFailure(502, "provider_error")).toBe(GENERIC_ERROR);
  });
});
