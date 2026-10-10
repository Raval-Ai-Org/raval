import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { emailConfirmationDestination, readEmailConfirmation } from "@/lib/email-confirmation";

const hash = "a".repeat(64);
const root = join(process.cwd(), "supabase", "email-templates");

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
