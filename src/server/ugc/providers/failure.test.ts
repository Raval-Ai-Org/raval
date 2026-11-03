import { describe, expect, it } from "vitest";
import { friendlyFailure, isSafetyRefusal, renderFailure } from "./failure";

describe("video render failures", () => {
  it.each([
    "Your prompt was flagged by our content moderation system",
    "The image violates our usage policies",
    "Content policy violation",
    "NSFW content detected",
    "Input contains prominent people",
    "Minors detected in the input image",
    "Request blocked by safety filter",
  ])("treats %j as a provider safety refusal", (message) => {
    expect(isSafetyRefusal(message)).toBe(true);
    expect(renderFailure(message)).toMatchObject({ code: "refusal", retryable: false });
  });

  it.each([
    "A minor error occurred while rendering",
    "Retry policy exhausted",
    "Header names are case-sensitive",
    "Upload failed against the storage server",
    "Image dimensions are too small",
  ])("does not call %j a safety refusal", (message) => {
    expect(isSafetyRefusal(message)).toBe(false);
    expect(friendlyFailure(message)).not.toMatch(/Safety review/);
  });

  it("submits again only after a failure that reads as an outage", () => {
    expect(renderFailure("Internal server error, please try again later")).toMatchObject({
      code: "render_failed",
      retryable: true,
    });
    expect(renderFailure("Service busy")).toMatchObject({ retryable: true });
    expect(renderFailure("Image dimensions are too small")).toMatchObject({ retryable: false });
    expect(renderFailure(null)).toMatchObject({ retryable: false });
  });
});
