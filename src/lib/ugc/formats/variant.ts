// A format's variant: which place, which twist and which opening pattern a
// video uses. Pure. Seeded and rotated per brand, so two videos of the same
// format never share a place and a twist (`pickVariant` skips the last ones).

import type { UgcFormat } from "./types";

export type FormatVariant = { place: string; twist: string; hook: number };

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Pick from `ids`, skipping `avoid` while anything else is left; `seed` decides among the rest. */
function pick<T>(items: readonly T[], avoid: readonly T[], seed: string): T {
  const fresh = items.filter((i) => !avoid.includes(i));
  const pool = fresh.length ? fresh : items;
  return pool[hash(seed) % pool.length];
}

/**
 * The variant for one video. `recent` is the brand's latest variants of this
 * format, newest first: the last two places, twists and openings are skipped
 * while others are left.
 */
export function pickVariant(
  format: UgcFormat,
  seed: string,
  recent: readonly FormatVariant[] = [],
): FormatVariant {
  const last = recent.slice(0, 2);
  const places = format.places.map((p) => p.id);
  const twists = format.twists.map((t) => t.id);
  const hooks = format.hookPatterns.map((_, i) => i);
  return {
    place: pick(
      places,
      last.map((v) => v.place),
      `${seed}:place:${format.id}`,
    ),
    twist: pick(
      twists,
      last.map((v) => v.twist),
      `${seed}:twist:${format.id}`,
    ),
    hook: pick(
      hooks,
      last.map((v) => v.hook),
      `${seed}:hook:${format.id}`,
    ),
  };
}

/** `count` variants that differ from each other and from the recent ones. */
export function pickVariants(
  format: UgcFormat,
  seed: string,
  recent: readonly FormatVariant[],
  count: number,
): FormatVariant[] {
  const out: FormatVariant[] = [];
  for (let i = 0; i < count; i++)
    out.push(pickVariant(format, `${seed}:${i}`, [...out].reverse().concat(recent)));
  return out;
}

/** The variant a script names, if it still exists in the format; else a fixed default. */
export function variantOf(
  format: UgcFormat,
  variant: Partial<FormatVariant> | null | undefined,
): { place: UgcFormat["places"][number]; twist: UgcFormat["twists"][number]; hook: string } {
  const place = format.places.find((p) => p.id === variant?.place) ?? format.places[0];
  const twist = format.twists.find((t) => t.id === variant?.twist) ?? format.twists[0];
  const index = typeof variant?.hook === "number" ? variant.hook : 0;
  return { place, twist, hook: format.hookPatterns[index] ?? format.hookPatterns[0] };
}
