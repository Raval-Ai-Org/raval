// image-retry.ts — when a refused Studio picture is sent again, and when.
//
// Pictures sent together (carousel slides, Story frames, versions) share one
// OpenRouter balance and rate limit: OpenRouter holds each picture's
// worst-case cost, so on a low balance most of a burst is refused in a second
// while one or two are made. Those refusals cost nothing. They wait for the
// pictures really in flight to finish and are then sent again ONE AT A TIME,
// so a Story or carousel is finished instead of failed. Pure: no I/O.

/** The fields of a provider task these rules read. */
export type RetryTask = {
  slot: string;
  kind: "image" | "video";
  taskId: string;
  state: "pending" | "done" | "failed";
  anchor?: { slot: string; started?: boolean };
  /** Refused and waiting for the pictures in flight to finish. */
  awaitingRetry?: boolean;
};

/**
 * Refusals another try can fix on any picture: balance and rate. A safety read
 * that couldn't run stops a single picture at once (the person tries again
 * later) and is tried again only inside a set, where its siblings passed.
 */
const PASSING_CODES = new Set(["insufficient_credits", "rate_limited"]);
/** Never sent again: the model or the safety check said no, or the key is wrong. */
const FINAL_CODES = new Set(["refusal", "missing_api_key", "invalid_api_key"]);

/** A slide, Story frame or version: one picture of a set made together. */
export function isSeriesSlot(slot: string): boolean {
  return /^(?:slide|frame|option):\d+$/.test(slot);
}

/**
 * Whether a refused picture should wait and be sent again. A passing refusal
 * always qualifies. In a set (Story frames, slides, versions) any other
 * refusal except a final one also qualifies: its siblings use the same kind of
 * prompt, a burst refusal costs nothing, and the caller caps the tries, so one
 * odd answer never throws away a whole Story (the 2026-11-15 Story failures:
 * frames 1-2 made, frame 3 refused in 0.2 s).
 */
export function shouldRetryRefusal(args: { task: RetryTask; code?: string }): boolean {
  if (args.task.kind !== "image") return false;
  const code = args.code ?? "";
  if (FINAL_CODES.has(code)) return false;
  if (PASSING_CODES.has(code)) return true;
  return isSeriesSlot(args.task.slot);
}

/** Not sent yet: a carousel slide still waiting for slide 1. */
export function isUnstarted(task: RetryTask): boolean {
  return !!task.anchor && !task.anchor.started;
}

/**
 * Pictures really rendering at the provider: pending, started and not
 * themselves waiting to be sent again. Waiting pictures never count, or two
 * refused pictures would wait for each other forever (the 2026-11-17 bug:
 * a carousel sat 30 minutes until its refusals expired, then timed out).
 */
export function imagesInFlight(tasks: RetryTask[]): number {
  return tasks.filter(
    (t) => t.kind === "image" && t.state === "pending" && !t.awaitingRetry && !isUnstarted(t),
  ).length;
}

/**
 * Which waiting pictures to send again now: the first one, and only when no
 * other picture is rendering, so they go one at a time.
 */
export function retriesToStart<T extends RetryTask>(tasks: T[], maxInFlight = 1): T[] {
  const room = Math.max(0, maxInFlight - imagesInFlight(tasks));
  return tasks.filter((t) => t.state === "pending" && t.awaitingRetry).slice(0, room);
}
