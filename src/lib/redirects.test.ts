import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirects";

describe("safeNextPath", () => {
  it("keeps internal paths with query strings", () => {
    expect(safeNextPath("/app?tab=overview")).toBe("/app?tab=overview");
  });

  it("rejects external and protocol-relative redirects", () => {
    expect(safeNextPath("https://example.com")).toBe("/projects");
    expect(safeNextPath("//example.com/projects")).toBe("/projects");
    expect(safeNextPath("javascript:alert(1)")).toBe("/projects");
  });
});
