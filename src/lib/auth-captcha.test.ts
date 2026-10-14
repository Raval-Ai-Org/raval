import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthCaptchaToken } from "./auth-captcha";

afterEach(() => vi.useRealTimers());

describe("authentication challenges", () => {
  it("leaves unconfigured authentication unchanged", () => {
    const challenge = new AuthCaptchaToken(false);
    expect(challenge.take()).toBeUndefined();
    expect(challenge.take()).toBeUndefined();
  });

  it("requires a fresh challenge when configured and consumes it once", () => {
    const challenge = new AuthCaptchaToken(true);
    expect(() => challenge.take()).toThrow("security check");
    challenge.accept("synthetic-response");
    expect(challenge.take()).toBe("synthetic-response");
    expect(() => challenge.take()).toThrow("security check");
  });

  it("rejects expired tokens, clears them, and accepts a new challenge", () => {
    vi.useFakeTimers();
    const challenge = new AuthCaptchaToken(true);
    challenge.accept("old-response");
    vi.advanceTimersByTime(290_000);
    expect(() => challenge.take()).toThrow("security check");
    challenge.accept("new-response");
    expect(challenge.take()).toBe("new-response");
  });

  it.each(["", "x".repeat(2049)])("rejects malformed responses", (token) => {
    const challenge = new AuthCaptchaToken(true);
    challenge.accept("previous-response");
    challenge.accept(token);
    expect(() => challenge.take()).toThrow("security check");
  });

  it("clears pending responses on failure, expiry or leaving the page", () => {
    const challenge = new AuthCaptchaToken(true);
    challenge.accept("pending-response");
    challenge.clear();
    expect(() => challenge.take()).toThrow("security check");
  });
});
