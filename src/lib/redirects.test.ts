import { describe, expect, it } from "vitest";
import { authNextPath, safeNextPath, startPathFor } from "./redirects";

describe("startPathFor", () => {
  it("turns a typed website into the start link", () => {
    expect(startPathFor("Mellox.ai")).toBe("/start?url=https%3A%2F%2Fmellox.ai");
    expect(startPathFor(" https://www.acme.com/ ")).toBe("/start?url=https%3A%2F%2Fwww.acme.com");
  });

  it("refuses anything that is not a website", () => {
    expect(startPathFor("")).toBeNull();
    expect(startPathFor("hello")).toBeNull();
    expect(startPathFor(null)).toBeNull();
  });
});

describe("authNextPath", () => {
  it("sends a website from the landing page to its scan", () => {
    expect(authNextPath("?url=acme.com")).toBe("/start?url=https%3A%2F%2Facme.com");
  });

  it("lets an explicit next win, and stays internal", () => {
    expect(authNextPath("?next=%2Fapp%3Finvite_token%3Dx&url=acme.com")).toBe(
      "/app?invite_token=x",
    );
    expect(authNextPath("?next=https%3A%2F%2Fevil.example")).toBe("/projects");
  });

  it("falls back to the workspace list", () => {
    expect(authNextPath("")).toBe("/projects");
    expect(authNextPath("?url=not-a-site")).toBe("/projects");
  });
});

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
