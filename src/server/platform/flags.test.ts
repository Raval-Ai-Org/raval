import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { envFlagName, isFlagOn, setFlagReader } from "./flags.server";

afterEach(() => {
  setFlagReader(null);
  delete process.env.FEATURE_FLAG_NEW_EDITOR_V2;
});

const on = { enabled: true, rolloutPercent: 100, workspaceIds: [], expiresAt: null };

describe("isFlagOn", () => {
  it("is off for a flag nobody created", async () => {
    setFlagReader(async () => ({}));
    expect(await isFlagOn("new-editor.v2", "w1")).toBe(false);
  });

  it("follows the row", async () => {
    setFlagReader(async () => ({ "new-editor.v2": on }));
    expect(await isFlagOn("new-editor.v2", "w1")).toBe(true);
  });

  it("lets an environment variable win both ways", async () => {
    setFlagReader(async () => ({ "new-editor.v2": on }));
    process.env.FEATURE_FLAG_NEW_EDITOR_V2 = "false";
    expect(await isFlagOn("new-editor.v2", "w1")).toBe(false);
    setFlagReader(async () => ({}));
    process.env.FEATURE_FLAG_NEW_EDITOR_V2 = "true";
    expect(await isFlagOn("new-editor.v2", "w1")).toBe(true);
  });

  it("is off when the table can't be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setFlagReader(async () => {
      throw new Error("down");
    });
    expect(await isFlagOn("new-editor.v2", "w1")).toBe(false);
    error.mockRestore();
  });

  it("names the variable from the key", () => {
    expect(envFlagName("new-editor.v2")).toBe("FEATURE_FLAG_NEW_EDITOR_V2");
  });
});
