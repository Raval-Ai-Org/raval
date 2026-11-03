/** Inline text requests have a 120 second limit. Allow ample headroom for cleanup. */
export const STUDIO_TEXT_TIMEOUT_MS = 15 * 60_000;
export const STUDIO_JOB_TIMEOUT_MS = 2 * 60 * 60_000;
export const STUDIO_IMAGE_RENDER_TIMEOUT_MS = 10 * 60_000;
export const STUDIO_COMPOSITION_TIMEOUT_MS = 30 * 60_000;
/** Putting the brand's own clips together runs on Mellox's own machine, not a provider. */
export const STUDIO_CLIP_EDIT_TIMEOUT_MS = 45 * 60_000;
/**
 * A provider render still pending after this is lost (providers report
 * success, failure or expiry long before): the job fails and its hold is
 * released, so credits are never held forever.
 */
export const STUDIO_PROVIDER_JOB_TIMEOUT_MS = 24 * 60 * 60_000;

/**
 * Provider-accepted videos are paid external jobs. Their provider status is
 * authoritative, so elapsed wall-clock time must never turn them into a local
 * failure. Images and local compositions retain bounded recovery windows.
 */
export function studioProviderTaskIsTimedOut(
  task: { kind: "image" | "video"; taskId: string; startedAt: number },
  now = Date.now(),
): boolean {
  if (task.taskId.startsWith("clip-edit:"))
    return now - task.startedAt > STUDIO_CLIP_EDIT_TIMEOUT_MS;
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
  const age = now - Date.parse(job.created_at);
  // An accepted provider render can legitimately remain queued for hours.
  // Keep reconciling it until the provider returns success or failure, up to
  // an absolute deadline that releases the hold of one that never answers.
  if (job.provider_tasks?.some((task) => task.state === "pending"))
    return age > STUDIO_PROVIDER_JOB_TIMEOUT_MS;
  if (age > STUDIO_JOB_TIMEOUT_MS) return true;
  return now - Date.parse(job.stage_at || job.created_at) > STUDIO_TEXT_TIMEOUT_MS;
}
