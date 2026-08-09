// feature-flags.ts — server-side feature flags. Read in server modules only
// (never VITE_*). Keeps the SDR rollout non-regressing (FR-017 / SC-007): when
// the flag is off, publish/schedule fall through to the existing mock behavior.

const ENV_FEATURE_SDR = "FEATURE_FLAG_SDR_ENABLED";

/** Is the real SDR distribution path enabled? Off by default. */
export function isSdrEnabled(): boolean {
  const v = process.env[ENV_FEATURE_SDR];
  if (v === undefined || v === "") return false;
  return v === "true" || v === "1" || v === "yes";
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
