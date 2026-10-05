// feature-flags.ts — server-side feature flags. Read in server modules only
// (never NEXT_PUBLIC_*). Distribution is refused honestly when no provider is
// configured (DISTRIBUTION_DISABLED) — nothing is ever marked sent.
import type { DistributionProvider } from "@/lib/distribution-platforms";

const ENV_FEATURE_SDR = "FEATURE_FLAG_SDR_ENABLED";

const isTruthy = (v: string) => v === "true" || v === "1" || v === "yes";
const isFalsy = (v: string) => v === "false" || v === "0" || v === "no";

/** Legacy configuration reader; SocialAPI is retired as a distribution provider. */
export function isSocialApiConfigured(): boolean {
  if (!process.env.SOCIALAPI_API_KEY) return false;
  return !isFalsy((process.env.FEATURE_FLAG_SOCIALAPI_ENABLED ?? "").trim().toLowerCase());
}

export function isPostForMeConfigured(): boolean {
  return Boolean(process.env.POST_FOR_ME_API_KEY?.trim());
}

/**
 * The deployment's distribution provider. An explicit DISTRIBUTION_PROVIDER
 * wins (and must be configured to count); otherwise Post for Me when its key
 * is present, else the self-hosted SDR when its flag is on. `null` = off.
 */
export function getDistributionProvider(): DistributionProvider | null {
  const explicit = (process.env.DISTRIBUTION_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "postforme") return isPostForMeConfigured() ? "postforme" : null;
  if (explicit === "socialapi") return null;
  if (explicit === "sdr") return isSdrEnabled() ? "sdr" : null;
  if (explicit === "none" || explicit === "off") return null;
  if (isPostForMeConfigured()) return "postforme";
  return isSdrEnabled() ? "sdr" : null;
}

/**
 * The provider for one workspace. The SDR keeps its existing per-workspace
 * opt-in (FEATURE_FLAG_SDR_ENABLED_WS_<id>).
 */
export function getDistributionProviderForWorkspace(
  workspaceId: string,
): DistributionProvider | null {
  const provider = getDistributionProvider();
  if (provider === "postforme") return "postforme";
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

/**
 * Google Analytics 4 + Search Console connector. On whenever the OAuth client
 * id is set, unless FEATURE_FLAG_GOOGLE_ANALYTICS_ENABLED=false;
 * FEATURE_FLAG_GOOGLE_ANALYTICS_ENABLED_WS_<id> overrides per workspace.
 */
export function isGoogleAnalyticsEnabled(workspaceId?: string): boolean {
  if (!process.env.GOOGLE_ANALYTICS_CLIENT_ID?.trim()) return false;
  if (workspaceId) {
    const perWs = (process.env[`FEATURE_FLAG_GOOGLE_ANALYTICS_ENABLED_WS_${workspaceId}`] ?? "")
      .trim()
      .toLowerCase();
    if (perWs) return isTruthy(perWs);
  }
  return !isFalsy((process.env.FEATURE_FLAG_GOOGLE_ANALYTICS_ENABLED ?? "").trim().toLowerCase());
}

/**
 * EXIF/XMP privacy cleanup + attribution for generated images
 * (src/server/assets/image-metadata.server.ts). Local processing, no paid
 * call, so on by default; the wrapper itself fails open to the original
 * bytes whenever Python/ExifTool aren't on PATH, so this flag exists purely
 * as an operational kill-switch, not a cost gate.
 * FEATURE_FLAG_ASSET_METADATA_ENABLED_WS_<id> overrides per workspace.
 */
/**
 * Social trends: a shared snapshot of what is working on each platform,
 * collected every few days (src/server/studio/social-trends.server.ts). On by
 * default; it only runs where a web research provider is configured.
 */
export function isSocialTrendsEnabled(): boolean {
  return !isFalsy((process.env.FEATURE_FLAG_SOCIAL_TRENDS_ENABLED ?? "").trim().toLowerCase());
}

export function isAssetMetadataFinalizeEnabled(workspaceId?: string): boolean {
  if (workspaceId) {
    const perWs = (process.env[`FEATURE_FLAG_ASSET_METADATA_ENABLED_WS_${workspaceId}`] ?? "")
      .trim()
      .toLowerCase();
    if (perWs) return !isFalsy(perWs);
  }
  return !isFalsy((process.env.FEATURE_FLAG_ASSET_METADATA_ENABLED ?? "").trim().toLowerCase());
}

/**
 * Proof Engine — controlled website experiments (ADR-0024). OFF unless
 * FEATURE_FLAG_PROOF_ENGINE_ENABLED is set; FEATURE_FLAG_PROOF_ENGINE_ENABLED_WS_<id>
 * overrides per workspace (either way). When off, the surface is hidden, its
 * routes and RPCs answer 404 and the worker skips the workspace.
 */
/**
 * Autopilot (ADR-0028). On unless set to "false"; `FEATURE_FLAG_AUTOPILOT_ENABLED_WS_<id>`
 * overrides the global flag for one workspace in either direction. Off means
 * the sidebar entry is hidden, RPCs answer 404 and the worker skips the workspace.
 */
export function isAutopilotEnabled(workspaceId?: string): boolean {
  if (workspaceId) {
    const perWs = (process.env[`FEATURE_FLAG_AUTOPILOT_ENABLED_WS_${workspaceId}`] ?? "")
      .trim()
      .toLowerCase();
    if (perWs) return !isFalsy(perWs);
  }
  return !isFalsy((process.env.FEATURE_FLAG_AUTOPILOT_ENABLED ?? "").trim().toLowerCase());
}

/**
 * Fully automatic mode: simple posts that pass every check are approved
 * without a person. Separate from the flag above; on unless set to "false",
 * and it needs Autopilot on. The checks themselves cannot be switched off.
 */
export function isFullAutopilotEnabled(workspaceId?: string): boolean {
  if (!isAutopilotEnabled(workspaceId)) return false;
  if (workspaceId) {
    const perWs = (process.env[`FEATURE_FLAG_AUTOPILOT_FULL_ENABLED_WS_${workspaceId}`] ?? "")
      .trim()
      .toLowerCase();
    if (perWs) return !isFalsy(perWs);
  }
  return !isFalsy((process.env.FEATURE_FLAG_AUTOPILOT_FULL_ENABLED ?? "").trim().toLowerCase());
}

/**
 * Stories (ADR-0030): Instagram and Facebook Stories in Studio, publishing,
 * the calendar, analytics and Story Autopilot. On unless set to "false";
 * `FEATURE_FLAG_STORIES_ENABLED_WS_<id>` overrides it for one workspace. Off
 * means Studio hides the format, new Story jobs answer 404, Story Autopilot
 * plans no Stories and Story items are not sent. Existing rows stay readable.
 */
export function isStoriesEnabled(workspaceId?: string): boolean {
  if (workspaceId) {
    const perWs = (process.env[`FEATURE_FLAG_STORIES_ENABLED_WS_${workspaceId}`] ?? "")
      .trim()
      .toLowerCase();
    if (perWs) return !isFalsy(perWs);
  }
  return !isFalsy((process.env.FEATURE_FLAG_STORIES_ENABLED ?? "").trim().toLowerCase());
}

/**
 * MCP server (ADR-0029): AI assistants operating Mellox. On unless set to
 * "false"; `FEATURE_FLAG_MCP_ENABLED_WS_<id>` overrides it for one workspace.
 * This is only the kill switch: a workspace is still off until an admin turns
 * it on in Settings.
 */
export function isMcpEnabled(workspaceId?: string): boolean {
  if (workspaceId) {
    const perWs = (process.env[`FEATURE_FLAG_MCP_ENABLED_WS_${workspaceId}`] ?? "")
      .trim()
      .toLowerCase();
    if (perWs) return !isFalsy(perWs);
  }
  return !isFalsy((process.env.FEATURE_FLAG_MCP_ENABLED ?? "").trim().toLowerCase());
}

/**
 * Audience (ADR-0031): audience groups, the Mellox Score, deeper checks and
 * version comparisons. On unless set to "false"; `FEATURE_FLAG_AUDIENCE_ENABLED_WS_<id>`
 * overrides it for one workspace. Off means the sidebar entry is hidden, RPCs
 * answer 404, the worker skips the workspace and generators get no audience block.
 */
export function isAudienceEnabled(workspaceId?: string): boolean {
  if (workspaceId) {
    const perWs = (process.env[`FEATURE_FLAG_AUDIENCE_ENABLED_WS_${workspaceId}`] ?? "")
      .trim()
      .toLowerCase();
    if (perWs) return !isFalsy(perWs);
  }
  return !isFalsy((process.env.FEATURE_FLAG_AUDIENCE_ENABLED ?? "").trim().toLowerCase());
}

/**
 * The quick score that follows a generation by itself. Separate so the one
 * unrequested model call can be switched off without losing the feature.
 */
export function isAudienceAutoScoreEnabled(workspaceId?: string): boolean {
  if (!isAudienceEnabled(workspaceId)) return false;
  return !isFalsy(
    (process.env.FEATURE_FLAG_AUDIENCE_AUTO_SCORE_ENABLED ?? "").trim().toLowerCase(),
  );
}

export function isProofEngineEnabled(workspaceId?: string): boolean {
  if (workspaceId) {
    const perWs = (process.env[`FEATURE_FLAG_PROOF_ENGINE_ENABLED_WS_${workspaceId}`] ?? "")
      .trim()
      .toLowerCase();
    if (perWs) return isTruthy(perWs);
  }
  return isTruthy((process.env.FEATURE_FLAG_PROOF_ENGINE_ENABLED ?? "").trim().toLowerCase());
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
