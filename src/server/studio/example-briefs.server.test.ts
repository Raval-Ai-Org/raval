import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { mechanismLineFor } from "./example-briefs.server";

const rows = [
  {
    id: "plumbing-01",
    sector: "plumbing",
    goal: "lead",
    format: "post",
    mechanism: "A fixed price before work starts removes the fear of a surprise bill.",
  },
  {
    id: "plumbing-02",
    sector: "plumbing",
    goal: "trust",
    format: "carousel",
    mechanism: "Showing the engineer's van and badge answers 'will they turn up'.",
  },
  {
    id: "cafe-01",
    sector: "cafe",
    goal: "sell",
    format: "post",
    mechanism: "A named daily special gives a reason to come today.",
  },
];

describe("mechanismLineFor", () => {
  it("prefers the same goal and format, and is stable", () => {
    const a = mechanismLineFor({
      sector: "plumbing",
      goal: "lead",
      format: "image",
      seed: "ws:1",
      rows,
    });
    expect(a?.id).toBe("plumbing-01");
    expect(
      mechanismLineFor({ sector: "plumbing", goal: "lead", format: "image", seed: "ws:1", rows }),
    ).toEqual(a);
  });
  it("skips recent ids and stays inside the sector", () => {
    const b = mechanismLineFor({
      sector: "plumbing",
      goal: "lead",
      format: "image",
      seed: "x",
      recent: ["plumbing-01"],
      rows,
    });
    expect(b?.id).toBe("plumbing-02");
  });
  it("gives nothing for an unknown sector or an empty library", () => {
    expect(mechanismLineFor({ sector: "law-firm", seed: "x", rows })).toBeNull();
    expect(mechanismLineFor({ sector: null, seed: "x", rows })).toBeNull();
    expect(mechanismLineFor({ sector: "plumbing", seed: "x", rows: [] })).toBeNull();
    // The shipped library covers the sector.
    expect(mechanismLineFor({ sector: "plumbing", seed: "x" })?.id).toMatch(/^plumbing-/);
  });
});
