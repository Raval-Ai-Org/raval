import { describe, expect, it } from "vitest";
import { shouldAskClarify } from "./clarify-gate";

describe("shouldAskClarify", () => {
  it("asks only for bare requests to make something", () => {
    expect(shouldAskClarify("write a post")).toBe(true);
    expect(shouldAskClarify("make me a campaign")).toBe(true);
  });

  it("answers straight away when the message already says enough", () => {
    expect(shouldAskClarify("how did my posts do last week?")).toBe(false);
    expect(shouldAskClarify("write a post about our summer sale")).toBe(false);
    expect(shouldAskClarify("make 3 reels")).toBe(false);
    expect(shouldAskClarify("hello")).toBe(false);
    expect(
      shouldAskClarify("write an instagram post for the new lavender candle with a calm tone"),
    ).toBe(false);
    expect(shouldAskClarify("")).toBe(false);
  });
});
