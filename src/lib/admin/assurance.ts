// assurance.ts — how strongly the admin proved who they are, read from the
// Supabase access-token claims. Pure so it can be tested without a session.
//
//   aal   "aal2" once a second factor (TOTP) was verified in this session.
//   amr   the sign-in methods used, each with the time it happened.

export type AuthClaims = {
  aal?: unknown;
  amr?: unknown;
};

export type Assurance = {
  /** A second factor was verified in this session. */
  mfa: boolean;
  /** Unix seconds of the most recent second-factor check, or null. */
  mfaAt: number | null;
};

export function assuranceOf(claims: AuthClaims | null | undefined): Assurance {
  const mfa = claims?.aal === "aal2";
  let mfaAt: number | null = null;
  if (Array.isArray(claims?.amr)) {
    for (const entry of claims.amr as unknown[]) {
      if (!entry || typeof entry !== "object") continue;
      const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
      if (method !== "totp" || typeof timestamp !== "number") continue;
      if (mfaAt === null || timestamp > mfaAt) mfaAt = timestamp;
    }
  }
  return { mfa, mfaAt };
}

/** Longest age of the last second-factor check a dangerous action accepts. */
export const FRESH_MFA_SECONDS = 10 * 60;

/** True when the second factor was verified within `maxAgeSeconds` of `now` (Unix seconds). */
export function isFreshMfa(
  assurance: Assurance,
  now = Math.floor(Date.now() / 1000),
  maxAgeSeconds = FRESH_MFA_SECONDS,
): boolean {
  if (!assurance.mfa || assurance.mfaAt === null) return false;
  const age = now - assurance.mfaAt;
  return age >= -30 && age <= maxAgeSeconds;
}
