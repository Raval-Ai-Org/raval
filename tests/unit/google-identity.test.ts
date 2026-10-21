import { afterEach, describe, expect, it, vi } from "vitest";
import { createGoogleNonce } from "@/lib/google-identity";
import { signInWithGoogle } from "@/lib/auth";

const auth = vi.hoisted(() => ({ signInWithIdToken: vi.fn(), signInWithOAuth: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth } }));
afterEach(() => vi.resetAllMocks());

describe("Google ID token sign-in", () => {
  it("passes a single-use CAPTCHA response to Supabase when protection is configured", async () => {
    auth.signInWithIdToken.mockResolvedValue({
      data: { user: { id: "id" }, session: { access_token: "session" } },
      error: null,
    });
    await signInWithGoogle("google-jwt", "raw-nonce", "synthetic-captcha-response");
    expect(auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "google-jwt",
      nonce: "raw-nonce",
      options: { captchaToken: "synthetic-captcha-response" },
    });
  });
  it("creates independent 256-bit nonces and sends their SHA-256 hex digest to Google", async () => {
    const a = await createGoogleNonce();
    const b = await createGoogleNonce();
    expect(a.nonce).toMatch(/^[a-f0-9]{64}$/);
    expect(a.nonce).not.toBe(b.nonce);
    const expected = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(a.nonce));
    expect(a.hashedNonce).toBe(Buffer.from(expected).toString("hex"));
    expect(a.hashedNonce).not.toBe(a.nonce);
  });

  it.each(["existing-google-user", "new-google-user", "linked-email-user"])(
    "returns Supabase's canonical identity and session for %s",
    async (id) => {
      const data = { user: { id }, session: { access_token: "supabase-session" } };
      auth.signInWithIdToken.mockResolvedValue({ data, error: null });
      expect(await signInWithGoogle("google-jwt", "raw-nonce")).toBe(data);
      expect(auth.signInWithIdToken).toHaveBeenCalledExactlyOnceWith({
        provider: "google",
        token: "google-jwt",
        nonce: "raw-nonce",
      });
      expect(auth.signInWithOAuth).not.toHaveBeenCalled();
    },
  );

  it("propagates rejected tokens without creating a local session", async () => {
    const error = new Error("Invalid nonce");
    auth.signInWithIdToken.mockResolvedValue({ data: { session: null }, error });
    await expect(signInWithGoogle("bad-jwt", "raw-nonce")).rejects.toBe(error);
  });

  it("rejects incomplete success responses", async () => {
    auth.signInWithIdToken.mockResolvedValue({
      data: { user: { id: "id" }, session: null },
      error: null,
    });
    await expect(signInWithGoogle("jwt", "nonce")).rejects.toThrow("no session");
  });

  it("never submits empty credentials or nonces", async () => {
    await expect(signInWithGoogle("", "nonce")).rejects.toThrow("Missing");
    await expect(signInWithGoogle("jwt", "")).rejects.toThrow("Missing");
    expect(auth.signInWithIdToken).not.toHaveBeenCalled();
  });
});
