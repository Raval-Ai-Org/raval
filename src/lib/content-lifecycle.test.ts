import { describe, expect, it } from "vitest";
import {
  assertContentTransition,
  canTransitionContent,
  hasMeaningfulContentChange,
} from "@/lib/content-lifecycle";

describe("content lifecycle", () => {
  it("allows approval and delivery transitions", () => {
    expect(canTransitionContent("pending", "approved")).toBe(true);
    expect(canTransitionContent("approved", "scheduled")).toBe(true);
    expect(canTransitionContent("publishing", "published")).toBe(true);
  });

  it("rejects impossible transitions", () => {
    expect(() => assertContentTransition("draft", "published")).toThrow(
      "Invalid content status transition: draft -> published",
    );
    expect(canTransitionContent("published", "approved")).toBe(false);
  });

  it("recognizes edits that invalidate approval", () => {
    expect(hasMeaningfulContentChange({ body: "new copy" })).toBe(true);
    expect(hasMeaningfulContentChange({ scheduled_at: "2026-09-08T10:00:00.000Z" })).toBe(false);
  });
});
