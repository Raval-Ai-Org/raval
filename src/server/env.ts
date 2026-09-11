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

const RECOMMENDED = ["ANTHROPIC_API_KEY", "KIE_API_KEY", "REDIS_URL", "SENTRY_DSN", "ALERT_WEBHOOK_URL"] as const;

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
    for (const name of ["SDR_BASE_URL", "SDR_ADMIN_TOKEN", "SDR_SECRET_ENCRYPTION_KEY", "SDR_WEBHOOK_BASE_URL"]) {
      if (!env[name]) errors.push(`${name} is required when FEATURE_FLAG_SDR_ENABLED is on`);
    }
  }
  if (env.APP_URL && env.NEXT_PUBLIC_APP_URL && env.APP_URL !== env.NEXT_PUBLIC_APP_URL) {
    warnings.push("APP_URL and NEXT_PUBLIC_APP_URL differ — canonical URLs and cron callbacks will disagree");
  }
  if (production && env.APP_URL && /localhost|127\.0\.0\.1/.test(env.APP_URL)) {
    errors.push("APP_URL points at localhost in production");
  }
  for (const name of RECOMMENDED) {
    if (!env[name]) warnings.push(`${name} is not set (the related feature is degraded or disabled)`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** The public origin of this deployment, without a trailing slash. */
export function getAppUrl(): string {
  const raw = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:8080";
  return raw.replace(/\/+$/, "");
}
