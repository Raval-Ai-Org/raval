import { describe, expect, it } from "vitest";
import { soleWorkspaceLanding } from "./paths";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("soleWorkspaceLanding", () => {
  it("opens the only workspace, or its setup", () => {
    expect(soleWorkspaceLanding([{ id: A, onboarded: true }], "")).toBe(`/w/${A}/app`);
    expect(soleWorkspaceLanding([{ id: A, onboarded: false }], "")).toBe(`/w/${A}/onboarding`);
  });

  it("keeps the list for two or more, none, or an explicit request", () => {
    const two = [
      { id: A, onboarded: true },
      { id: B, onboarded: true },
    ];
    expect(soleWorkspaceLanding(two, "")).toBeNull();
    expect(soleWorkspaceLanding([], "")).toBeNull();
    expect(soleWorkspaceLanding([{ id: A, onboarded: true }], "?all=1")).toBeNull();
    expect(soleWorkspaceLanding([{ id: A, onboarded: true }], "?add=x.com")).toBeNull();
  });
});
