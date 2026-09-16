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

/**
 * UGC Video Ads (Kie.ai video renders). On whenever KIE_API_KEY is set, unless
 * FEATURE_FLAG_UGC_VIDEO_ENABLED=false; FEATURE_FLAG_UGC_VIDEO_ENABLED_WS_<id>
 * overrides per workspace.
 */
export function isUgcVideoEnabled(workspaceId?: string): boolean {
  if (!process.env.KIE_API_KEY?.trim()) return false;
  if (workspaceId) {
    const perWs = (process.env[`FEATURE_FLAG_UGC_VIDEO_ENABLED_WS_${workspaceId}`] ?? "")
      .trim()
      .toLowerCase();
    if (perWs) return !isFalsy(perWs);
  }
  return !isFalsy((process.env.FEATURE_FLAG_UGC_VIDEO_ENABLED ?? "").trim().toLowerCase());
}

/**
 * AI answer-engine probes for AI Visibility scans: each full scan asks a few
 * questions of the models in GEO_PROBE_MODELS through OpenRouter (metered and
 * budget-checked). Paid per scan, so OFF unless FEATURE_FLAG_GEO_AI_PROBES_ENABLED
 * is set; FEATURE_FLAG_GEO_AI_PROBES_ENABLED_WS_<id> overrides per workspace.
 */
export function isGeoProbesEnabled(workspaceId?: string): boolean {
  if (workspaceId) {
    const perWs = (process.env[`FEATURE_FLAG_GEO_AI_PROBES_ENABLED_WS_${workspaceId}`] ?? "")
      .trim()
      .toLowerCase();
    if (perWs) return isTruthy(perWs);
  }
  if (!process.env.OPENROUTER_API_KEY) return false;
  return isTruthy((process.env.FEATURE_FLAG_GEO_AI_PROBES_ENABLED ?? "").trim().toLowerCase());
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
