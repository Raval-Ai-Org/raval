/** Short-lived, single-use client state. Supabase performs authoritative verification. */
export class AuthCaptchaToken {
  private token: string | undefined;
  private expiresAt = 0;

  constructor(readonly enabled: boolean) {}

  accept(token: string): void {
    this.clear();
    if (!token || token.length > 2048) return;
    this.token = token;
    // Leave a small margin for the request to reach Supabase before expiry.
    this.expiresAt = Date.now() + 290_000;
  }

  clear(): void {
    this.token = undefined;
    this.expiresAt = 0;
  }

  take(): string | undefined {
    if (!this.enabled) return undefined;
    const token = this.token;
    const valid = this.expiresAt > Date.now();
    this.clear();
    if (!token || !valid) throw new Error("Please complete the security check and try again.");
    return token;
  }
}
