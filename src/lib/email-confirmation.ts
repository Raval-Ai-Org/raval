import type { EmailOtpType } from "@supabase/supabase-js";

export const EMAIL_CONFIRMATION_TYPES = [
  "email",
  "signup",
  "recovery",
  "invite",
  "magiclink",
  "email_change",
] as const satisfies readonly EmailOtpType[];

export function readEmailConfirmation(hash: string): {
  token_hash: string;
  type: EmailOtpType;
} | null {
  const params = new URLSearchParams(hash.replace(/^[#?]/, ""));
  const token_hash = params.get("token_hash");
  const type = params.get("type");
  // GoTrue prefixes PKCE signup/recovery hashes with `pkce_`. Preserve it:
  // it is part of the stored token, not an encoding to strip off.
  if (!token_hash || !/^(?:pkce_)?[a-f0-9]{32,128}$/i.test(token_hash)) return null;
  if (params.getAll("token_hash").length !== 1 || params.getAll("type").length !== 1) return null;
  if (!EMAIL_CONFIRMATION_TYPES.some((allowed) => allowed === type)) return null;
  return { token_hash, type: type as EmailOtpType };
}

export type EmailConfirmation = NonNullable<ReturnType<typeof readEmailConfirmation>>;
export type PendingEmailConfirmation = {
  confirmation: EmailConfirmation;
  at: number;
  verifiedUserId?: string;
};
const PENDING_KEY = "mellox:email-confirmation";
const PENDING_TTL = 60 * 60 * 1000;

/** Tab-only recovery after refresh/mobile suspension; never store in localStorage. */
export function saveEmailConfirmation(pending: PendingEmailConfirmation | null) {
  try {
    if (pending) window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    else window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // In-memory confirmation still works when browser storage is unavailable.
  }
}

export function captureEmailConfirmation(hash: string): PendingEmailConfirmation | null {
  if (hash) {
    const confirmation = readEmailConfirmation(hash);
    const pending = confirmation ? { confirmation, at: Date.now() } : null;
    saveEmailConfirmation(pending);
    return pending;
  }
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    const pending = raw ? (JSON.parse(raw) as PendingEmailConfirmation) : null;
    const age = pending ? Date.now() - pending.at : NaN;
    const confirmation = pending?.confirmation
      ? readEmailConfirmation(new URLSearchParams(pending.confirmation).toString())
      : null;
    if (
      pending &&
      Number.isFinite(age) &&
      age >= 0 &&
      age < PENDING_TTL &&
      confirmation &&
      (pending.verifiedUserId === undefined || typeof pending.verifiedUserId === "string")
    )
      return { confirmation, at: pending.at, verifiedUserId: pending.verifiedUserId };
  } catch {
    /* Invalid or blocked storage is treated as a missing link. */
  }
  saveEmailConfirmation(null);
  return null;
}

export function emailConfirmationDestination(type: EmailOtpType): string {
  return type === "recovery" ? "/reset-password" : "/projects";
}
