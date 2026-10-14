import { describe, expect, it, vi } from "vitest";
import { isMissingRpc } from "./schedules.server";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("./ai", () => ({ runStructuredPrompt: vi.fn() }));
vi.mock("./ai/prompts", () => ({ SCHEDULE_SYSTEMS: {} }));

describe("scheduler claim fallback", () => {
  it.each(["42501", "PGRST301", "08006"])(
    "refuses an unlocked sweep for a non-missing RPC error: %s",
    (code) => {
      expect(
        isMissingRpc({ code, message: "permission denied for function claim_due_scheduled_jobs" }),
      ).toBe(false);
    },
  );
  it("recognizes actual missing functions and schema-cache misses", () => {
    expect(isMissingRpc({ code: "PGRST202" })).toBe(true);
    expect(isMissingRpc({ code: "42883" })).toBe(true);
    expect(
      isMissingRpc({
        message:
          "Could not find the function public.claim_due_scheduled_jobs(p_max) in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingRpc({ message: "function public.claim_due_scheduled_jobs() does not exist" }),
    ).toBe(true);
  });
  it("does not mistake other function failures or named permission errors for missing claims", () => {
    expect(
      isMissingRpc({ message: "permission denied for function claim_due_scheduled_jobs" }),
    ).toBe(false);
    expect(isMissingRpc({ message: "Could not find the function public.unrelated_rpc" })).toBe(
      false,
    );
    expect(isMissingRpc(null)).toBe(false);
  });
});
