import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  captureEmailConfirmation,
  emailConfirmationDestination,
  readEmailConfirmation,
  saveEmailConfirmation,
} from "@/lib/email-confirmation";

const hash = "a".repeat(64);
const root = join(process.cwd(), "supabase", "email-templates");
afterEach(() => vi.unstubAllGlobals());

describe("Supabase email confirmation", () => {
  it("accepts only an expected OTP type and hash", () => {
    expect(readEmailConfirmation(`#token_hash=${hash}&type=email`)).toEqual({
      token_hash: hash,
      type: "email",
    });
    expect(readEmailConfirmation(`#token_hash=${hash}&type=recovery`)?.type).toBe("recovery");
    expect(readEmailConfirmation(`#token_hash=${hash}&type=redirect`)).toBeNull();
    expect(readEmailConfirmation("#token_hash=bad&type=email")).toBeNull();
  });

  it("preserves real PKCE-prefixed GoTrue hashes for signup, recovery and email change", () => {
    for (const type of ["email", "signup", "recovery", "email_change", "invite", "magiclink"]) {
      const token_hash = `pkce_${"a".repeat(56)}`;
      expect(readEmailConfirmation(`#token_hash=${token_hash}&type=${type}`)).toEqual({
        token_hash,
        type,
      });
    }
    expect(readEmailConfirmation(`#token_hash=${hash}&type=email&type=recovery`)).toBeNull();
    expect(readEmailConfirmation(`#token_hash=${hash}&token_hash=${hash}&type=email`)).toBeNull();
    expect(readEmailConfirmation(`#token_hash=pkce_bad&type=email`)).toBeNull();
    expect(readEmailConfirmation(`#token_hash={{ .TokenHash }}&type=email`)).toBeNull();
  });

  it("survives tab reload, expires stale state, and lets a resent link replace the previous one", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    const initial = captureEmailConfirmation(`#token_hash=pkce_${hash}&type=email`)!;
    expect(captureEmailConfirmation("")).toEqual(initial);
    const resent = captureEmailConfirmation(`#token_hash=${"b".repeat(56)}&type=email`)!;
    expect(captureEmailConfirmation("")).toEqual(resent);
    saveEmailConfirmation({ ...resent, verifiedUserId: "verified-user" });
    expect(captureEmailConfirmation("")?.verifiedUserId).toBe("verified-user");
    saveEmailConfirmation({ ...initial, at: Date.now() - 3_600_001 });
    expect(captureEmailConfirmation("")).toBeNull();
    expect(values.size).toBe(0);
    captureEmailConfirmation(`#token_hash=${hash}&type=email`);
    expect(captureEmailConfirmation("#invalid")).toBeNull();
    expect(captureEmailConfirmation("")).toBeNull();
  });

  it("still captures a link when private browsing blocks storage", () => {
    vi.stubGlobal("window", {
      get sessionStorage() {
        throw new Error("blocked");
      },
    });
    expect(
      captureEmailConfirmation(`#token_hash=pkce_${hash}&type=email`)?.confirmation.token_hash,
    ).toBe(`pkce_${hash}`);
    expect(captureEmailConfirmation("")).toBeNull();
  });

  it("sends recovery to the password form and other types to the app", () => {
    expect(emailConfirmationDestination("recovery")).toBe("/reset-password");
    expect(emailConfirmationDestination("invite")).toBe("/projects");
  });

  it("ships static, branded Dashboard templates with a safe click-through", () => {
    for (const [file, type] of [
      ["confirmation.html", "email"],
      ["recovery.html", "recovery"],
      ["invite.html", "invite"],
      ["magic-link.html", "magiclink"],
      ["email-change.html", "email_change"],
    ]) {
      const body = readFileSync(join(root, file), "utf8");
      expect(body).toContain("https://mellox.ai/assets/mellox-email-mark.png");
      expect(body).toContain(
        `https://mellox.ai/auth/confirm#token_hash={{ .TokenHash }}&amp;type=${type}`,
      );
      expect(body).not.toContain("{{ .ConfirmationURL }}");
      expect(body).not.toContain("{{ .RedirectTo }}");
    }
    const reauth = readFileSync(join(root, "reauthentication.html"), "utf8");
    expect(reauth).toContain("{{ .Token }}");
    expect(reauth).not.toContain("token_hash=");
  });
});
