// feature-flags.ts — server-side feature flags. Read in server modules only
// (never NEXT_PUBLIC_*). Distribution is refused honestly when no provider is
// configured (DISTRIBUTION_DISABLED) — nothing is ever marked sent.
import type { DistributionProvider } from "@/lib/distribution-platforms";

const ENV_FEATURE_SDR = "FEATURE_FLAG_SDR_ENABLED";

const isTruthy = (v: string) => v === "true" || v === "1" || v === "yes";
const isFalsy = (v: string) => v === "false" || v === "0" || v === "no";

/** SocialAPI.ai has a server-side key and is not switched off globally. */
export function isSocialApiConfigured(): boolean {
  if (!process.env.SOCIALAPI_API_KEY) return false;
  return !isFalsy((process.env.FEATURE_FLAG_SOCIALAPI_ENABLED ?? "").trim().toLowerCase());
}

/**
 * The deployment's distribution provider. An explicit DISTRIBUTION_PROVIDER
 * wins (and must be configured to count); otherwise SocialAPI.ai when its key
 * is present, else the self-hosted SDR when its flag is on. `null` = off.
 */
export function getDistributionProvider(): DistributionProvider | null {
  const explicit = (process.env.DISTRIBUTION_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "socialapi") return isSocialApiConfigured() ? "socialapi" : null;
  if (explicit === "sdr") return isSdrEnabled() ? "sdr" : null;
  if (explicit === "none" || explicit === "off") return null;
  if (isSocialApiConfigured()) return "socialapi";
  return isSdrEnabled() ? "sdr" : null;
}

/**
 * The provider for one workspace. FEATURE_FLAG_SOCIALAPI_ENABLED_WS_<id>=false
 * switches a single tenant off without a deploy; the SDR keeps its existing
 * per-workspace opt-in (FEATURE_FLAG_SDR_ENABLED_WS_<id>).
 */
export function getDistributionProviderForWorkspace(
  workspaceId: string,
): DistributionProvider | null {
  const provider = getDistributionProvider();
  if (provider === "socialapi") {
    const perWs = (process.env[`FEATURE_FLAG_SOCIALAPI_ENABLED_WS_${workspaceId}`] ?? "")
      .trim()
      .toLowerCase();
    return perWs && isFalsy(perWs) ? null : "socialapi";
  }
  const explicit = (process.env.DISTRIBUTION_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "socialapi" || explicit === "none" || explicit === "off") return null;
  return isSdrEnabledForWorkspace(workspaceId) ? "sdr" : null;
}

/** Is the real SDR distribution path enabled? Off by default. */
export function isSdrEnabled(): boolean {
  const v = process.env[ENV_FEATURE_SDR];
  if (v === undefined || v === "") return false;
  return isTruthy(v);
}

/**
 * Per-workspace override (future-proofing). Defaults to the global flag.
 * A workspace-level kill-switch lets us disable a single tenant without a deploy.
 */
export function isSdrEnabledForWorkspace(workspaceId: string): boolean {
  const perWs = process.env[`FEATURE_FLAG_SDR_ENABLED_WS_${workspaceId}`];
  if (perWs !== undefined && perWs !== "") {
    return perWs === "true" || perWs === "1" || perWs === "yes";
  }
  return isSdrEnabled();
}
