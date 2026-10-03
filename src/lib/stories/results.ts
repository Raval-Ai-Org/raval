// Delivery of a multi-frame Story, one account at a time. Pure.
//
// Post for Me turns a Story post with N media items into N Stories, and
// reports one result per (account, media item). Mellox keeps one delivery row
// per (content item, account), so the row carries the frames: which provider
// post each frame belongs to and how it went. That makes three things exact:
//
//   * a row is `published` only when every frame went out;
//   * a frame that went out never goes back (terminal wins, as for posts);
//   * a retry resends only the frames that failed, as its own provider post,
//     so nothing that already appeared is posted twice.

export type FrameStatus = "pending" | "publishing" | "published" | "failed";

export type FrameResult = {
  /** Position in the Story, from 0. */
  i: number;
  status: FrameStatus;
  /** The provider post this frame was sent in (a retry has its own). */
  postId: string;
  /** Stable workspace storage path (or external URL) used for this frame. */
  source?: string | null;
  platformPostId?: string | null;
  permalink?: string | null;
  error?: string | null;
};

/** One provider result for a frame, as the adapter reports it. */
export type IncomingFrame = {
  /** Index into the provider post's own media list, when the adapter knows it. */
  frame?: number | null;
  status: FrameStatus;
  platformPostId?: string | null;
  permalink?: string | null;
  error?: string | null;
};

export function initialFrames(count: number, postId: string, status: FrameStatus): FrameResult[] {
  return Array.from({ length: Math.max(1, count) }, (_, i) => ({ i, status, postId }));
}

export function readFrames(value: unknown): FrameResult[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const out: FrameResult[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const status = r.status;
    if (
      typeof r.i !== "number" ||
      typeof r.postId !== "string" ||
      !["pending", "publishing", "published", "failed"].includes(String(status))
    )
      return null;
    out.push({
      i: r.i,
      status: status as FrameStatus,
      postId: r.postId,
      source: typeof r.source === "string" ? r.source : null,
      platformPostId: typeof r.platformPostId === "string" ? r.platformPostId : null,
      permalink: typeof r.permalink === "string" ? r.permalink : null,
      error: typeof r.error === "string" ? r.error : null,
    });
  }
  return out.sort((a, b) => a.i - b.i);
}

/**
 * Apply one provider post's results for one account to the row's frames.
 * Only frames sent in `postId` are touched; they are matched by the media
 * index the provider reported. An unidentified result can settle a single
 * frame, but is never guessed for a multi-frame Story: a wrong match could
 * make a retry republish a frame that already went out. `fallback` is the status for
 * frames the provider has not reported yet (pending while scheduled, else
 * publishing; cancelled posts pass "failed" with an error).
 */
export function mergeFrames(
  frames: FrameResult[],
  postId: string,
  incoming: IncomingFrame[],
  fallback: { status: FrameStatus; error?: string | null } | null,
): FrameResult[] {
  const mine = frames.filter((f) => f.postId === postId).sort((a, b) => a.i - b.i);
  const byLocal = new Map<number, IncomingFrame>();
  const unplaced: IncomingFrame[] = [];
  for (const r of incoming) {
    if (
      typeof r.frame === "number" &&
      r.frame >= 0 &&
      r.frame < mine.length &&
      !byLocal.has(r.frame)
    )
      byLocal.set(r.frame, r);
    else unplaced.push(r);
  }
  if (mine.length === 1 && unplaced.length && !byLocal.has(0)) byLocal.set(0, unplaced[0]);
  const updates = new Map<number, FrameResult>();
  mine.forEach((frame, k) => {
    const r = byLocal.get(k);
    if (frame.status === "published") return; // terminal wins
    if (r) {
      updates.set(frame.i, {
        ...frame,
        status: r.status,
        platformPostId: r.platformPostId ?? frame.platformPostId ?? null,
        permalink: r.permalink ?? frame.permalink ?? null,
        error: r.status === "failed" ? (r.error ?? "The network rejected this frame.") : null,
      });
    } else if (fallback && frame.status !== "failed") {
      updates.set(frame.i, {
        ...frame,
        status: fallback.status,
        error: fallback.status === "failed" ? (fallback.error ?? null) : null,
      });
    }
  });
  return frames.map((f) => updates.get(f.i) ?? f);
}

export type RowOutcome = {
  status: "pending" | "publishing" | "published" | "failed";
  platformPostId: string | null;
  permalink: string | null;
  error: string | null;
  sent: number;
  total: number;
};

/** What the delivery row says, from its frames. */
export function rowOutcome(frames: FrameResult[]): RowOutcome {
  const total = frames.length;
  const sent = frames.filter((f) => f.status === "published").length;
  const failed = frames.filter((f) => f.status === "failed");
  const first = frames.find((f) => f.status === "published");
  const base = {
    platformPostId: first?.platformPostId ?? null,
    permalink: first?.permalink ?? null,
    sent,
    total,
  };
  if (sent === total) return { ...base, status: "published", error: null };
  if (frames.some((f) => f.status === "publishing"))
    return { ...base, status: "publishing", error: null };
  if (frames.some((f) => f.status === "pending") && !failed.length)
    return { ...base, status: "pending", error: null };
  if (frames.some((f) => f.status === "pending"))
    return { ...base, status: "publishing", error: null };
  const reason = failed.find((f) => f.error)?.error ?? "The network rejected the Story.";
  return {
    ...base,
    status: "failed",
    error:
      sent > 0
        ? `${sent} of ${total} frames went out; ${failed.length} failed. ${reason}`
        : total > 1
          ? `None of the ${total} frames went out. ${reason}`
          : reason,
  };
}

/** The frames a retry should send again: exactly the failed ones, in order. */
export function framesToRetry(frames: FrameResult[]): number[] {
  return frames.filter((f) => f.status === "failed").map((f) => f.i);
}

/** Point the retried frames at the retry's provider post. */
export function markRetried(
  frames: FrameResult[],
  indexes: number[],
  postId: string,
): FrameResult[] {
  const set = new Set(indexes);
  return frames.map((f) =>
    set.has(f.i)
      ? { ...f, status: "publishing", postId, platformPostId: null, permalink: null, error: null }
      : f,
  );
}

/** The provider posts a row's frames live in (one, plus one per retry). */
export function framePostIds(frames: FrameResult[] | null, fallback: string): string[] {
  if (!frames?.length) return [fallback];
  return [...new Set(frames.map((f) => f.postId))];
}
