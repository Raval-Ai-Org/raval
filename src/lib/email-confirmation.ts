import type { EmailOtpType } from "@supabase/supabase-js";

export const EMAIL_CONFIRMATION_TYPES = [
  "email",
  "recovery",
  "invite",
  "magiclink",
  "email_change",
] as const satisfies readonly EmailOtpType[];

export function readEmailConfirmation(hash: string): {
  token_hash: string;
  type: EmailOtpType;
} | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token_hash = params.get("token_hash");
  const type = params.get("type");
  if (!token_hash || !/^[a-f0-9]{32,128}$/i.test(token_hash)) return null;
  if (!EMAIL_CONFIRMATION_TYPES.some((allowed) => allowed === type)) return null;
  return { token_hash, type: type as EmailOtpType };
}

export function emailConfirmationDestination(type: EmailOtpType): string {
  return type === "recovery" ? "/reset-password" : "/projects";
}
