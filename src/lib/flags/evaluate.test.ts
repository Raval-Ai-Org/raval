import { describe, expect, it } from "vitest";
import { bucketOf, evaluateFlag, FLAG_KEY_PATTERN, type FlagRule } from "./evaluate";

const rule = (patch: Partial<FlagRule> = {}): FlagRule => ({
  enabled: true,
  rolloutPercent: 100,
  workspaceIds: [],
  expiresAt: null,
  ...patch,
});

describe("evaluateFlag", () => {
  it("is off when disabled, unless the workspace is on the allow list", () => {
    expect(evaluateFlag("x.y", rule({ enabled: false }), "w1")).toBe(false);
    expect(evaluateFlag("x.y", rule({ enabled: false, workspaceIds: ["w1"] }), "w1")).toBe(true);
    expect(evaluateFlag("x.y", rule({ enabled: false, workspaceIds: ["w1"] }), "w2")).toBe(false);
  });

  it("is off after its end date, even for the allow list", () => {
    const expired = rule({ workspaceIds: ["w1"], expiresAt: "2026-01-01T00:00:00Z" });
    expect(evaluateFlag("x.y", expired, "w1", Date.parse("2026-06-01T00:00:00Z"))).toBe(false);
    expect(evaluateFlag("x.y", expired, "w1", Date.parse("2025-06-01T00:00:00Z"))).toBe(true);
  });

  it("rolls out by a stable bucket and only ever grows", () => {
    const ids = Array.from({ length: 400 }, (_, i) => `ws-${i}`);
    const at = (pct: number) =>
      new Set(ids.filter((id) => evaluateFlag("beta", rule({ rolloutPercent: pct }), id)));
    const ten = at(10);
    const fifty = at(50);
    for (const id of ten) expect(fifty.has(id)).toBe(true);
    expect(ten.size).toBeGreaterThan(10);
    expect(ten.size).toBeLessThan(80);
    expect(fifty.size).toBeGreaterThan(150);
    expect(at(0).size).toBe(0);
    expect(at(100).size).toBe(400);
  });

  it("keeps a partial roll-out off when there is no workspace", () => {
    expect(evaluateFlag("beta", rule({ rolloutPercent: 50 }), null)).toBe(false);
    expect(evaluateFlag("beta", rule({ rolloutPercent: 100 }), null)).toBe(true);
  });

  it("buckets are in range and stable", () => {
    expect(bucketOf("a", "b")).toBe(bucketOf("a", "b"));
    expect(bucketOf("a", "b")).toBeGreaterThanOrEqual(0);
    expect(bucketOf("a", "b")).toBeLessThan(100);
  });

  it("validates keys", () => {
    expect(FLAG_KEY_PATTERN.test("new-editor.v2")).toBe(true);
    expect(FLAG_KEY_PATTERN.test("Bad Key")).toBe(false);
    expect(FLAG_KEY_PATTERN.test("ab")).toBe(false);
  });
});
