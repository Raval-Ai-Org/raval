// evaluate.ts — decides whether a database flag is on for a workspace.
// Pure and browser-safe. The rules, in order:
//   1. past its end date → off
//   2. the workspace is on the flag's allow list → on
//   3. the flag is not enabled → off
//   4. a gradual roll-out: the workspace is in the flag's first N% of buckets.
// The bucket comes from the flag key and the workspace id, so the same
// workspace gets the same answer every time and a roll-out only ever grows.

export type FlagRule = {
  enabled: boolean;
  rolloutPercent: number;
  workspaceIds: readonly string[];
  expiresAt: string | null;
};

/** FNV-1a: small, stable across processes, good enough to spread ids evenly. */
export function bucketOf(key: string, subject: string): number {
  let hash = 0x811c9dc5;
  const text = `${key}:${subject}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

export function evaluateFlag(
  key: string,
  rule: FlagRule,
  workspaceId: string | null | undefined,
  now = Date.now(),
): boolean {
  if (rule.expiresAt && Date.parse(rule.expiresAt) <= now) return false;
  if (workspaceId && rule.workspaceIds.includes(workspaceId)) return true;
  if (!rule.enabled) return false;
  if (rule.rolloutPercent >= 100) return true;
  if (rule.rolloutPercent <= 0 || !workspaceId) return false;
  return bucketOf(key, workspaceId) < rule.rolloutPercent;
}

export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9_.-]{2,59}$/;
