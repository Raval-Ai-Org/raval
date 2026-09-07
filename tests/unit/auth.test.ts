import { describe, expect, it } from "vitest";
import { friendlyAuthError, safeNextPath } from "@/lib/auth";

describe("auth helpers", () => {
  it("accepts only safe relative next paths", () => {
    expect(safeNextPath("/projects")).toBe("/projects");
    expect(safeNextPath("//attacker.example")).toBe("/app");
    expect(safeNextPath("https://attacker.example")).toBe("/app");
    expect(safeNextPath(null)).toBe("/app");
  });

  it("maps provider setup failures without exposing provider details", () => {
    const message = friendlyAuthError(
      new Error("invalid_client: client_secret=do-not-show redirect_uri mismatch"),
    );

    expect(message).toContain("callback URL is not configured");
    expect(message).not.toContain("do-not-show");
    expect(message).not.toContain("invalid_client");
  });

  it("handles cancellation as a retryable user action", () => {
    expect(friendlyAuthError(new Error("access_denied"))).toBe(
      "Google sign-in was cancelled before it finished.",
    );
  });
});
