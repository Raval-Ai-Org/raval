/** Inline text requests have a 120 second limit. Allow ample headroom for cleanup. */
export const STUDIO_TEXT_TIMEOUT_MS = 15 * 60_000;
export const STUDIO_JOB_TIMEOUT_MS = 2 * 60 * 60_000;

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
  if (now - Date.parse(job.created_at) > STUDIO_JOB_TIMEOUT_MS) return true;
  return (
    !job.provider_tasks?.some((task) => task.state === "pending") &&
    now - Date.parse(job.stage_at || job.created_at) > STUDIO_TEXT_TIMEOUT_MS
  );
}
