import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { setSwitchReader, switchBlockFor } from "./switches.server";

afterEach(() => setSwitchReader(null));

describe("emergency switches", () => {
  it("blocks only the area that was stopped", async () => {
    setSwitchReader(async () => ({ ai_image: true, ai_text: false }));
    expect(await switchBlockFor("image")).toMatch(/Image generation is paused/);
    expect(await switchBlockFor("text")).toBeNull();
    expect(await switchBlockFor("video")).toBeNull();
  });

  it("keeps running when the table can't be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setSwitchReader(async () => {
      throw new Error("down");
    });
    expect(await switchBlockFor("text")).toBeNull();
    error.mockRestore();
  });

  it("answers from a short cache instead of reading every call", async () => {
    const reader = vi.fn(async () => ({ ai_search: true }));
    setSwitchReader(reader);
    await switchBlockFor("search");
    await switchBlockFor("search");
    expect(reader).toHaveBeenCalledTimes(1);
  });
});
