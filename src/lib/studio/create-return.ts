// Where Back returns to in Create (browser-only memory, pure).
//
// Create is two steps (a starting point, then a format). A format opens a
// place of its own: a Studio composer, Animate or the creator video studio.
// Back there is one step out, so it reopens Create on the list the person
// picked from, not the first screen. The spot is keyed by what was opened
// (a Studio session id, "animate", "ugc") so a composer opened from Home
// never lands on a list the person didn't come from.

let spot: { key: string; groupId: string | null } | null = null;

export function rememberCreateSpot(key: string | null | undefined, groupId: string | null) {
  spot = key ? { key, groupId } : null;
}

/**
 * The list to reopen for `key`, once. Undefined when that place wasn't opened
 * from Create (or Back was already used).
 */
export function takeCreateSpot(key: string): string | null | undefined {
  if (!spot || spot.key !== key) return undefined;
  const { groupId } = spot;
  spot = null;
  return groupId;
}

/** Whether `key` was opened from Create (without using the spot up). */
export function cameFromCreate(key: string): boolean {
  return spot?.key === key;
}
