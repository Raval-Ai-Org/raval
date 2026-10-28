/** Inline text requests have a 120 second limit. Allow ample headroom for cleanup. */
export const STUDIO_TEXT_TIMEOUT_MS = 15 * 60_000;
export const STUDIO_JOB_TIMEOUT_MS = 2 * 60 * 60_000;
export const STUDIO_IMAGE_RENDER_TIMEOUT_MS = 10 * 60_000;
export const STUDIO_COMPOSITION_TIMEOUT_MS = 30 * 60_000;

/**
 * Provider-accepted videos are paid external jobs. Their provider status is
 * authoritative, so elapsed wall-clock time must never turn them into a local
 * failure. Images and local compositions retain bounded recovery windows.
 */
export function studioProviderTaskIsTimedOut(
  task: { kind: "image" | "video"; taskId: string; startedAt: number },
  now = Date.now(),
): boolean {
  if (task.kind === "video") return false;
  const timeout = task.taskId.startsWith("composition:")
    ? STUDIO_COMPOSITION_TIMEOUT_MS
    : STUDIO_IMAGE_RENDER_TIMEOUT_MS;
  return now - task.startedAt > timeout;
}

export function studioJobIsStale(
  job: {
    status: string;
    created_at: string;
    stage_at: string;
    provider_tasks?: { state: string }[];
  },
  now = Date.now(),
): boolean {
  if (!["running", "queued"].includes(job.status)) return false;
  // An accepted provider render can legitimately remain queued for hours.
  // Keep reconciling it until the provider returns success or failure.
  if (job.provider_tasks?.some((task) => task.state === "pending")) return false;
  if (now - Date.parse(job.created_at) > STUDIO_JOB_TIMEOUT_MS) return true;
  return now - Date.parse(job.stage_at || job.created_at) > STUDIO_TEXT_TIMEOUT_MS;
}
