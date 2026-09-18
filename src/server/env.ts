// env.ts — the one place server configuration is declared and validated
// (proposal workstream G). Validated once at boot from src/instrumentation.ts:
// in production a missing REQUIRED variable stops the server with a clear
// message instead of failing later on the first request that needs it;
// missing OPTIONAL variables are listed once as warnings (features degrade).
import "server-only";
import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const Schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // Core — required in production.
  APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  OPENROUTER_API_KEY: z.string().startsWith("sk-or-"),
  CRON_SECRET: z.string().min(16),
  // Providers — optional; the feature reports "not configured" without them.
  ANTHROPIC_API_KEY: z.string().optional(),
  KIE_API_KEY: z.string().optional(),
  // UGC Video Ads (docs/ugc-video-ads.md). Callbacks are optional; polling always works.
  KIE_WEBHOOK_HMAC_KEY: z.string().optional(),
  KIE_USD_PER_CREDIT: z.coerce.number().positive().optional(),
  UGC_DEFAULT_MODEL: z.string().optional(),
  UGC_MAX_CONCURRENT_RENDERS: z.coerce.number().int().min(1).max(20).optional(),
  FEATURE_FLAG_UGC_VIDEO_ENABLED: z.string().optional(),
  DATAFORSEO_LOGIN: z.string().optional(),
  DATAFORSEO_PASSWORD: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  UNSPLASH_ACCESS_KEY: z.string().optional(),
  // Distribution (SDR) — required only when the flag is on.
  FEATURE_FLAG_SDR_ENABLED: z.string().optional(),
  SDR_BASE_URL: optionalUrl,
  SDR_ADMIN_TOKEN: z.string().optional(),
  SDR_SECRET_ENCRYPTION_KEY: z.string().optional(),
  SDR_WEBHOOK_BASE_URL: optionalUrl,
  SDR_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(60).optional(),
  // Distribution provider — socialapi | sdr | none. Default: SocialAPI.ai when its key is set.
  DISTRIBUTION_PROVIDER: z.enum(["socialapi", "sdr", "none", "off", ""]).optional(),
  // SocialAPI.ai — server-only. Never expose as NEXT_PUBLIC_*.
  SOCIALAPI_API_KEY: z.string().startsWith("sapi_key_").optional().or(z.literal("")),
  SOCIALAPI_BASE_URL: optionalUrl,
  SOCIALAPI_WEBHOOK_SECRET: z.string().optional(),
  SOCIALAPI_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(60).optional(),
  FEATURE_FLAG_SOCIALAPI_ENABLED: z.string().optional(),
  // GitHub App (source connector) — server-only. Never expose as NEXT_PUBLIC_*.
  GITHUB_APP_ID: z.string().regex(/^\d+$/).optional().or(z.literal("")),
  GITHUB_APP_SLUG: z.string().optional(),
  GITHUB_APP_NAME: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_INSTALL_VERIFICATION: z.enum(["oauth", "install_window", ""]).optional(),
  GITHUB_ALLOWED_RETURN_ORIGINS: z.string().optional(),
  // Google Analytics 4 + Search Console connector (docs/google-analytics-connector.md).
  // A web OAuth client separate from the Supabase sign-in client. Server-only.
  GOOGLE_ANALYTICS_CLIENT_ID: z.string().optional(),
  GOOGLE_ANALYTICS_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ANALYTICS_REDIRECT_URI: optionalUrl,
  // base64 of 32 random bytes — encrypts Google refresh/access tokens at rest.
  GOOGLE_TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_ALLOWED_RETURN_ORIGINS: z.string().optional(),
  FEATURE_FLAG_GOOGLE_ANALYTICS_ENABLED: z.string().optional(),
  // AI Visibility rendering fallback + fix verification.
  FEATURE_FLAG_GEO_RENDERING_ENABLED: z.string().optional(),
  GEO_RENDER_EXECUTABLE: z.string().optional(),
  GEO_RENDER_WS_ENDPOINT: z.string().optional(),
  GEO_RENDER_NO_SANDBOX: z.string().optional(),
  GEO_FIX_VERIFY_DELAYS: z.string().optional(),
  // Operations — optional.
  REDIS_URL: z.string().optional(),
  SENTRY_DSN: optionalUrl,
  ALERT_WEBHOOK_URL: optionalUrl,
  AGENTS_DISABLED: z.string().optional(),
  AI_USER_DAILY_USD: z.coerce.number().min(0).optional(),
});

export type ServerEnv = z.infer<typeof Schema>;

const REQUIRED_IN_PRODUCTION = [
  "APP_URL",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "OPENROUTER_API_KEY",
  "CRON_SECRET",
] as const;

const RECOMMENDED = [
  "ANTHROPIC_API_KEY",
  "KIE_API_KEY",
  "REDIS_URL",
  "SENTRY_DSN",
  "ALERT_WEBHOOK_URL",
] as const;

export type EnvReport = { ok: boolean; errors: string[]; warnings: string[] };

/** Validate an env object. Pure — exported for tests. */
export function checkEnv(env: Record<string, string | undefined>): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const production = env.NODE_ENV === "production";

  const parsed = Schema.partial().safeParse(env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = issue.path.join(".");
      // Never echo the value — only the variable name and the rule.
      (production ? errors : warnings).push(`${name}: ${issue.message}`);
    }
  }
  for (const name of REQUIRED_IN_PRODUCTION) {
    if (!env[name]) (production ? errors : warnings).push(`${name} is not set`);
  }
  if (env.FEATURE_FLAG_SDR_ENABLED && /^(1|true|yes)$/i.test(env.FEATURE_FLAG_SDR_ENABLED)) {
    for (const name of [
      "SDR_BASE_URL",
      "SDR_ADMIN_TOKEN",
      "SDR_SECRET_ENCRYPTION_KEY",
      "SDR_WEBHOOK_BASE_URL",
    ]) {
      if (!env[name]) errors.push(`${name} is required when FEATURE_FLAG_SDR_ENABLED is on`);
    }
  }
  if (env.GITHUB_APP_ID) {
    for (const name of ["GITHUB_APP_SLUG", "GITHUB_APP_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET"]) {
      if (!env[name]) warnings.push(`${name} is not set (the GitHub connector is disabled)`);
    }
    if (!env.GITHUB_CLIENT_ID) {
      warnings.push("GITHUB_CLIENT_ID is not set — GitHub OAuth installs can't be verified");
    }
    if (!env.GITHUB_CLIENT_SECRET) {
      (production ? warnings : warnings).push(
        "GITHUB_CLIENT_SECRET is not set — GitHub installs can't be verified with OAuth" +
          (production ? " and new GitHub connections are refused" : ""),
      );
    }
  }
  if (env.GOOGLE_ANALYTICS_CLIENT_ID || env.GOOGLE_ANALYTICS_CLIENT_SECRET) {
    for (const name of ["GOOGLE_ANALYTICS_CLIENT_ID", "GOOGLE_ANALYTICS_CLIENT_SECRET"]) {
      if (!env[name]) errors.push(`${name} is required when the Google Analytics connector is configured`);
    }
    const key = env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? "";
    if (!key) {
      errors.push("GOOGLE_TOKEN_ENCRYPTION_KEY is required when the Google Analytics connector is configured");
    } else if (Buffer.from(key, "base64").length !== 32) {
      errors.push("GOOGLE_TOKEN_ENCRYPTION_KEY must be base64 of exactly 32 bytes");
    }
  }
  if ((env.DISTRIBUTION_PROVIDER ?? "").toLowerCase() === "socialapi" && !env.SOCIALAPI_API_KEY) {
    errors.push("SOCIALAPI_API_KEY is required when DISTRIBUTION_PROVIDER is socialapi");
  }
  if (env.SOCIALAPI_API_KEY && !env.SOCIALAPI_WEBHOOK_SECRET) {
    warnings.push(
      "SOCIALAPI_WEBHOOK_SECRET is not set (delivery status relies on the 5-minute reconcile sweep)",
    );
  }
  // A provider secret in a NEXT_PUBLIC_* variable is inlined into the browser bundle.
  for (const name of Object.keys(env)) {
    if (
      /^NEXT_PUBLIC_.*(SOCIALAPI|SDR_ADMIN|SERVICE_ROLE|GITHUB_APP_PRIVATE|GITHUB_WEBHOOK|GITHUB_CLIENT_SECRET|GOOGLE_ANALYTICS_CLIENT_SECRET|GOOGLE_TOKEN_ENCRYPTION|GOOGLE_CLIENT_SECRET)/i.test(
        name,
      ) &&
      env[name]
    ) {
      errors.push(`${name} exposes a server-only secret to the browser — remove it`);
    }
  }
  if (env.APP_URL && env.NEXT_PUBLIC_APP_URL && env.APP_URL !== env.NEXT_PUBLIC_APP_URL) {
    warnings.push(
      "APP_URL and NEXT_PUBLIC_APP_URL differ — canonical URLs and cron callbacks will disagree",
    );
  }
  if (production && env.APP_URL && /localhost|127\.0\.0\.1/.test(env.APP_URL)) {
    errors.push("APP_URL points at localhost in production");
  }
  for (const name of RECOMMENDED) {
    if (!env[name])
      warnings.push(`${name} is not set (the related feature is degraded or disabled)`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** The public origin of this deployment, without a trailing slash. */
export function getAppUrl(): string {
  const raw = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:8080";
  return raw.replace(/\/+$/, "");
}
