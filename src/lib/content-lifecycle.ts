export const CONTENT_STATUSES = [
  "draft",
  "pending",
  "approved",
  "rejected",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "partial_failed",
] as const;

export type ContentStatus = (typeof CONTENT_STATUSES)[number];

const TRANSITIONS: Record<ContentStatus, readonly ContentStatus[]> = {
  draft: ["draft", "pending", "approved"],
  pending: ["pending", "draft", "approved", "rejected", "failed"],
  approved: ["approved", "draft", "scheduled", "publishing", "published"],
  rejected: ["rejected", "draft", "pending"],
  scheduled: ["scheduled", "approved", "draft", "publishing", "failed"],
  publishing: ["publishing", "published", "partial_failed", "failed"],
  published: ["published", "draft"],
  failed: ["failed", "draft", "pending", "approved"],
  partial_failed: ["partial_failed", "approved", "scheduled", "draft"],
};

export function isContentStatus(value: string): value is ContentStatus {
  return (CONTENT_STATUSES as readonly string[]).includes(value);
}

export function canTransitionContent(from: ContentStatus, to: ContentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertContentTransition(from: string, to: string): asserts to is ContentStatus {
  if (!isContentStatus(from) || !isContentStatus(to) || !canTransitionContent(from, to)) {
    throw new Error(`Invalid content status transition: ${from} -> ${to}`);
  }
}

/** Shallow-merge a meta patch into the stored meta; `null` removes a key. */
export function mergeMeta(
  current: unknown,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(next)) {
    if (value === null) delete base[key];
    else base[key] = value;
  }
  return base;
}

export function hasMeaningfulContentChange(patch: Record<string, unknown>): boolean {
  return ["title", "body", "hashtags", "channel", "media_url", "meta"].some(
    (field) => field in patch,
  );
}
