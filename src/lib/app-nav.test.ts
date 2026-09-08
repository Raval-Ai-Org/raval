import { describe, expect, it } from "vitest";
import { workspaceModules } from "./app-nav";

describe("workspace navigation", () => {
  it("keeps Library in the sidebar, not in the primary top-level navigation", () => {
    expect(workspaceModules.some((module) => module.to === "/app/library")).toBe(false);
    expect(workspaceModules.some((module) => module.to === "/app" && module.label === "Chat")).toBe(true);
  });
});
