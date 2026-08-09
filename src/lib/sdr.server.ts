// sdr.server.ts — server-only SDR integration primitives (HMAC verification,
// idempotency keys, authoritative platform limits, and the low-level SDR HTTP
// client). Never imported from client code. The per-workspace token is supplied
// by callers (read from workspace_sdr server-side); nothing here touches secrets
// in the browser.
//
// Wire identifiers use `twitter` (matching the SDR contract + RavalAI PlatformId),
// NOT `x` (the display label only). See specs/001-sdr-integration (F1).

import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const SDR_PLATFORMS = ["twitter", "linkedin", "facebook", "instagram"] as const;
export type SdrPlatform = (typeof SDR_PLATFORMS)[number];

// ─── HMAC webhook verification ──────────────────────────────────────────────
// The SDR signs the raw body: X-Signature-256 = "sha256=<hex>" of
// HMAC-SHA256(secret, "POST|/webhook|<rawBody>")  (SDR webhook_out.py:148-153).
export function verifyWebhookSignature(secret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(`POST|/webhook|${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ─── Idempotency keys (FR-006 / FR-023) ─────────────────────────────────────
// The SDR idempotency key identifies a JOB (one content item → its selected
// target accounts). So the key is per item × canonical target-set, not per
// account. `revision` increments on republish-after-failure so the SDR treats
// it as a fresh job (never returns the old failed one). Re-submitting the same
// key returns the existing job (no duplicate — SC-003).
export function targetFingerprint(accountIds: string[]): string {
  const canonical = [...accountIds].sort().join(",");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export function deriveIdempotencyKey(opts: {
  kind: "publish" | "schedule";
  contentItemId: string;
  platform: string;
  targetFingerprint: string;
  revision: number;
}): string {
  return `${opts.kind}:${opts.contentItemId}:${opts.platform}:${opts.targetFingerprint}:${opts.revision}`;
}

// ─── Scheduling / timezone (FR-008 / FR-025) ────────────────────────────────
/** A naive local ISO string (user's timezone) → absolute UTC instant. JS Date
 * interprets a tz-less string as LOCAL time; toISOString() yields UTC. */
export function toUtcIso(localNaiveIso: string): string {
  const d = new Date(localNaiveIso);
  if (Number.isNaN(d.getTime())) {
    throw new SdrError("PLATFORM_VALIDATION", `Invalid scheduled time: ${localNaiveIso}`);
  }
  return d.toISOString();
}

const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;

/** The SDR rejects schedules more than 1 year out and requires the future. */
export function isScheduleWithinWindow(utcIso: string, maxMs: number = ONE_YEAR_MS): boolean {
  const t = new Date(utcIso).getTime();
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  return t > now && t - now <= maxMs;
}

// ─── Authoritative platform limits (FR-027) ─────────────────────────────────
// Seeded from the SDR adapters' get_capabilities (X 280/4, LinkedIn 3000/1,
// Facebook 63206/20, Instagram 2200/1 + exactly-one-media). Single source of
// truth for pre-publish validation.
export const PLATFORM_LIMITS: Record<SdrPlatform, { maxText: number; maxMedia: number; requiresMedia: boolean }> = {
  twitter: { maxText: 280, maxMedia: 4, requiresMedia: false },
  linkedin: { maxText: 3000, maxMedia: 1, requiresMedia: false },
  facebook: { maxText: 63206, maxMedia: 20, requiresMedia: false },
  instagram: { maxText: 2200, maxMedia: 1, requiresMedia: true },
};

export type ValidateContentInput = { text?: string | null; mediaUrls?: string[] | null };

/** Returns a list of user-visible validation errors (empty = valid). */
export function validateContentForPlatform(platform: string, content: ValidateContentInput): string[] {
  const limits = PLATFORM_LIMITS[platform as SdrPlatform];
  if (!limits) return [`Unsupported platform: ${platform}`];
  const errors: string[] = [];
  const text = content.text ?? "";
  const media = content.mediaUrls ?? [];
  if (text.length > limits.maxText) {
    errors.push(`Text exceeds ${limits.maxText} characters (current: ${text.length}).`);
  }
  if (media.length > limits.maxMedia) {
    errors.push(`Media exceeds ${limits.maxMedia} item(s) (current: ${media.length}).`);
  }
  if (limits.requiresMedia && media.length !== 1) {
    errors.push("Instagram requires exactly one media item attached to the post.");
  }
  return errors;
}

// ─── Error taxonomy (RavalAI server → Studio) ───────────────────────────────
export type SdrErrorCode =
  | "PLATFORM_VALIDATION"
  | "ACCOUNT_EXPIRED"
  | "SDR_UNREACHABLE"
  | "DUPLICATE"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "UNKNOWN";

export class SdrError extends Error {
  constructor(
    public code: SdrErrorCode,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "SdrError";
  }
}

/** Map an SDR HTTP status to our taxonomy (mirrors the plan's error table). */
export function classifySdrStatus(status: number): SdrErrorCode {
  if (status === 401 || status === 403) return "ACCOUNT_EXPIRED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "DUPLICATE";
  if (status === 422 || status === 400) return "PLATFORM_VALIDATION";
  if (status >= 500) return "SDR_UNREACHABLE";
  return "UNKNOWN";
}

// ─── Low-level SDR HTTP client ──────────────────────────────────────────────
// The base URL is trusted server config (set by provisioning, never user input).
// Loopback is permitted for local/dev integration; other private hosts are
// rejected (SSRF hardening). The per-workspace token is supplied by the caller.
function assertSdrBaseUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new SdrError("SDR_UNREACHABLE", "SDR base URL must be http(s)");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (isLoopback) return u; // dev integration against a local SDR
  if (
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(host) ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new SdrError("SDR_UNREACHABLE", "SDR base URL is a private host");
  }
  return u;
}

export async function callSdr(opts: {
  baseUrl: string;
  token: string;
  method?: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  timeoutMs?: number;
}): Promise<{ status: number; data: any }> {
  const base = assertSdrBaseUrl(opts.baseUrl);
  const u = new URL(opts.path.replace(/^\//, ""), base.href.endsWith("/") ? base.href : base.href + "/");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  const started = Date.now();
  try {
    const res = await fetch(u.toString(), {
      method: opts.method ?? "GET",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    // Observability (Rule 19): log every SDR proxy call — outcome + latency.
    console.log(`[sdr] ${opts.method ?? "GET"} ${opts.path} → ${res.status} (${Date.now() - started}ms)`);
    return { status: res.status, data };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      console.error(`[sdr] ${opts.method ?? "GET"} ${opts.path} → TIMEOUT (${opts.timeoutMs ?? 10_000}ms)`);
      throw new SdrError("SDR_UNREACHABLE", `SDR request timed out after ${opts.timeoutMs ?? 10_000}ms`);
    }
    console.error(`[sdr] ${opts.method ?? "GET"} ${opts.path} → UNREACHABLE: ${e instanceof Error ? e.message : String(e)}`);
    throw new SdrError("SDR_UNREACHABLE", `SDR unreachable: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}
