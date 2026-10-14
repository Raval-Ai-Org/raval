import { beforeEach, describe, expect, it, vi } from "vitest";
import { preparePasswordRecovery } from "./password-recovery";

const auth = vi.hoisted(() => ({
  setSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));

beforeEach(() => {
  vi.resetAllMocks();
  const response = { data: { session: { access_token: "session" } }, error: null };
  auth.setSession.mockResolvedValue(response);
  auth.exchangeCodeForSession.mockResolvedValue(response);
  auth.getSession.mockResolvedValue(response);
});

describe("password recovery", () => {
  it("keeps the verifier flow ID after the page scrubs the reset URL", async () => {
    expect(
      await preparePasswordRecovery(
        "https://mellox.ai/reset-password?code=one-time&sb_flow_id=recovery-flow",
      ),
    ).toBe(true);
    expect(auth.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("one-time", {
      flowId: "recovery-flow",
    });
  });

  it("passes an explicitly invalid flow ID to Supabase instead of borrowing another flow", async () => {
    await preparePasswordRecovery("https://mellox.ai/reset-password?code=one-time&sb_flow_id=");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("one-time", { flowId: "" });
  });
  it("exchanges only the decoded authorization code from the reset URL", async () => {
    expect(
      await preparePasswordRecovery(
        "https://mellox.ai/reset-password?code=one%2Btime&next=%2Fprojects",
      ),
    ).toBe(true);
    expect(auth.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith("one+time");
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it("restores a token-based recovery session", async () => {
    expect(
      await preparePasswordRecovery(
        "https://mellox.ai/reset-password#access_token=access&refresh_token=refresh&type=recovery",
      ),
    ).toBe(true);
    expect(auth.setSession).toHaveBeenCalledExactlyOnceWith({
      access_token: "access",
      refresh_token: "refresh",
    });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("supports an already-established session from the email confirmation page", async () => {
    expect(await preparePasswordRecovery("https://mellox.ai/reset-password")).toBe(true);
    expect(auth.getSession).toHaveBeenCalledOnce();
  });

  it.each([
    "?error=access_denied&error_description=private-provider-diagnostics",
    "#error_description=expired",
    "#access_token=access",
    "#refresh_token=refresh",
    "#access_token=&refresh_token=refresh",
    "?code=",
  ])("rejects an invalid recovery link even if another session exists: %s", async (suffix) => {
    await expect(
      preparePasswordRecovery(`https://mellox.ai/reset-password${suffix}`),
    ).rejects.toThrow("reset link");
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it.each([
    ["?code=one-time", "exchangeCodeForSession"],
    ["#access_token=access&refresh_token=refresh", "setSession"],
    ["", "getSession"],
  ] as const)(
    "propagates provider failures without falling back to an unrelated session: %s",
    async (suffix, method) => {
      const error = new Error("provider rejected request");
      auth[method].mockResolvedValue({ data: { session: null }, error });
      await expect(
        preparePasswordRecovery(`https://mellox.ai/reset-password${suffix}`),
      ).rejects.toBe(error);
    },
  );

  it("propagates thrown network failures for the page to recover from", async () => {
    const error = new Error("network unavailable");
    auth.exchangeCodeForSession.mockRejectedValue(error);
    await expect(
      preparePasswordRecovery("https://mellox.ai/reset-password?code=one-time"),
    ).rejects.toBe(error);
    expect(auth.getSession).not.toHaveBeenCalled();
  });

  it.each([
    ["?code=one-time", "exchangeCodeForSession"],
    ["#access_token=access&refresh_token=refresh", "setSession"],
    ["", "getSession"],
  ] as const)(
    "keeps the password form unavailable when no session is returned: %s",
    async (suffix, method) => {
      auth[method].mockResolvedValue({ data: { session: null }, error: null });
      expect(await preparePasswordRecovery(`https://mellox.ai/reset-password${suffix}`)).toBe(
        false,
      );
    },
  );
});
