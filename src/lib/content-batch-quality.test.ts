import { describe, expect, it } from "vitest";
import { validContentBatch } from "./content-batch-quality";

const plan = [
  { channel: "instagram", kind: "post" },
  { channel: "blog", kind: "blog" },
];
const social =
  "A weekly planning ritual helps small teams choose one customer question and answer it with a practical example.";
const article = Array.from({ length: 260 }, (_, index) => `detail${index}`).join(" ");

describe("mixed content batch validation", () => {
  it("accepts the requested formats in order with a substantive article", () => {
    expect(
      validContentBatch({
        drafts: [
          { channel: "instagram", kind: "post", body: social },
          { channel: "blog", kind: "blog", body: article },
        ],
        count: 2,
        channels: ["instagram", "blog"],
        plan,
        recentBodies: [],
      }),
    ).toBe(true);
  });

  it("rejects thin articles, wrong formats and repeated copy", () => {
    const base = { count: 2, channels: ["instagram", "blog"], plan, recentBodies: [] };
    expect(
      validContentBatch({
        ...base,
        drafts: [
          { channel: "instagram", kind: "post", body: social },
          { channel: "blog", kind: "blog", body: "Too short to answer a reader's question." },
        ],
      }),
    ).toBe(false);
    expect(
      validContentBatch({
        ...base,
        drafts: [
          { channel: "instagram", kind: "image", body: social },
          { channel: "blog", kind: "blog", body: article },
        ],
      }),
    ).toBe(false);
    expect(
      validContentBatch({
        drafts: [{ channel: "instagram", kind: "post", body: social }],
        count: 1,
        channels: ["instagram"],
        recentBodies: [social],
      }),
    ).toBe(false);
  });
});
