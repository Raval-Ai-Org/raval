// When the brand's own Inspo media (product shots, people, clips) is put on a
// new piece by itself, and which one. Pure: no I/O.
//
// Own media is used only sometimes, never on every piece: a roll seeded by
// the piece decides, at a rate the brand chooses in Inspo → Media
// (`look.visual.ownMedia`). Two pieces in a row never both get one by
// themselves, and the same photo rests between uses.
//
// Every photo is "permanent" (the product, the team: comes back now and then)
// or "temporary" (an event, a season: used a couple of times while it's fresh,
// then left alone). A person's own pick in Studio or a campaign always stands;
// this only decides what code adds on its own.

export const MEDIA_LIFETIMES = ["permanent", "temporary"] as const;
export type MediaLifetime = (typeof MEDIA_LIFETIMES)[number];

export const OWN_MEDIA_FREQUENCIES = ["rarely", "sometimes", "often"] as const;
export type OwnMediaFrequency = (typeof OWN_MEDIA_FREQUENCIES)[number];

export type RotationMedia = {
  assetId: string;
  kind: "image" | "video";
  purpose: "product" | "person";
  lifetime: MediaLifetime;
  /** When it was added (ISO). Temporary media expires from this. */
  addedAt: string;
  label?: string;
};

/** One earlier piece that carried this asset (ISO time). */
export type MediaUseRecord = { assetId: string; at: string };

const DAY = 86_400_000;

/** The rules per lifetime. Never loosen these to fill more posts. */
export const LIFETIME_RULES = {
  /** Comes back now and then: rests 3 days, at most 3 uses in any 14 days. */
  permanent: {
    restDays: 3,
    windowDays: 14,
    perWindow: 3,
    maxUses: Infinity,
    expiresDays: Infinity,
  },
  /** Used while fresh: at most 2 uses ever, 2 days apart, and only for 30 days. */
  temporary: { restDays: 2, windowDays: 30, perWindow: 2, maxUses: 2, expiresDays: 30 },
} as const;

/** Base chance a piece gets own media by itself, per brand setting. */
const BASE_CHANCE: Record<OwnMediaFrequency, number> = {
  rarely: 0.15,
  sometimes: 0.3,
  often: 0.55,
};

/** Formats where a real photo fits best get it more often. Ads and articles never by themselves. */
const FORMAT_WEIGHT: Record<string, number> = {
  story: 1.4,
  carousel: 1.2,
  image: 1,
  social: 0.8,
  video: 0.7,
};

/**
 * How many photos a format takes when it gets own media by itself. Only
 * formats that place the real photo (photo design, carousel frames); Story
 * frames would redraw it, so a person adds photos to a Story themselves.
 */
const PER_FORMAT: Record<string, number> = { carousel: 3, image: 1, social: 1 };

export function lifetimeOf(source: { region?: unknown; campaign?: string | null }): MediaLifetime {
  const stored = (source.region as { lifetime?: unknown } | null | undefined)?.lifetime;
  if (stored === "permanent" || stored === "temporary") return stored;
  return source.campaign ? "temporary" : "permanent";
}

export function frequencyOf(value: unknown): OwnMediaFrequency {
  return value === "rarely" || value === "often" ? value : "sometimes";
}

/** A stable number in [0, 1) from a string, so the same piece always rolls the same. */
export function roll(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function mediaChance(frequency: OwnMediaFrequency, format: string): number {
  return Math.min(0.9, BASE_CHANCE[frequency] * (FORMAT_WEIGHT[format] ?? 0));
}

/** Media that may be used now, given how and when it was used before. */
export function eligibleMedia(
  media: readonly RotationMedia[],
  uses: readonly MediaUseRecord[],
  now: Date,
): RotationMedia[] {
  const t = now.getTime();
  return media.filter((m) => {
    const rule = LIFETIME_RULES[m.lifetime];
    const added = Date.parse(m.addedAt);
    if (Number.isFinite(added) && t - added > rule.expiresDays * DAY) return false;
    const mine = uses.filter((u) => u.assetId === m.assetId).map((u) => Date.parse(u.at));
    if (mine.length >= rule.maxUses) return false;
    if (mine.some((at) => t - at < rule.restDays * DAY)) return false;
    return mine.filter((at) => t - at < rule.windowDays * DAY).length < rule.perWindow;
  });
}

/** Least used first, then longest rested; fresh temporary media before permanent. */
export function rankMedia(
  media: readonly RotationMedia[],
  uses: readonly MediaUseRecord[],
): RotationMedia[] {
  const count = (id: string) => uses.filter((u) => u.assetId === id).length;
  const last = (id: string) =>
    Math.max(0, ...uses.filter((u) => u.assetId === id).map((u) => Date.parse(u.at) || 0));
  return [...media].sort(
    (a, b) =>
      count(a.assetId) - count(b.assetId) ||
      Number(a.lifetime === "permanent") - Number(b.lifetime === "permanent") ||
      last(a.assetId) - last(b.assetId) ||
      a.assetId.localeCompare(b.assetId),
  );
}

export type RotationPick = { assetIds: string[]; reason: string };

/**
 * Own photos for one new piece, or none. `lastPieceUsedMedia` is whether the
 * brand's previous piece already carried own media by itself: then this one
 * doesn't, so own photos never run back to back.
 */
export function pickRotationMedia(args: {
  media: readonly RotationMedia[];
  uses: readonly MediaUseRecord[];
  now: Date;
  format: string;
  seed: string;
  frequency?: OwnMediaFrequency;
  lastPieceUsedMedia?: boolean;
}): RotationPick | null {
  const want = PER_FORMAT[args.format];
  if (!want || args.lastPieceUsedMedia) return null;
  const chance = mediaChance(args.frequency ?? "sometimes", args.format);
  if (roll(args.seed) >= chance) return null;
  const photos = rankMedia(
    eligibleMedia(
      args.media.filter((m) => m.kind === "image"),
      args.uses,
      args.now,
    ),
    args.uses,
  );
  if (!photos.length) return null;
  // A product shot leads where there's one; people and the rest follow.
  const lead = photos.find((m) => m.purpose === "product") ?? photos[0];
  const rest = photos.filter((m) => m !== lead);
  const picked = [lead, ...rest].slice(0, want);
  return {
    assetIds: picked.map((m) => m.assetId),
    reason: picked.some((m) => m.lifetime === "temporary")
      ? "Uses a recent photo from Inspo while it's fresh."
      : "Uses one of your own photos from Inspo.",
  };
}

/**
 * How many times each photo may still be placed in a plan of many pieces
 * (campaigns): temporary ones what's left of their two, permanent ones a few.
 */
export function remainingUses(
  media: readonly RotationMedia[],
  uses: readonly MediaUseRecord[],
  now: Date,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of eligibleMedia(media, uses, now)) {
    const used = uses.filter((u) => u.assetId === m.assetId).length;
    out.set(m.assetId, m.lifetime === "temporary" ? LIFETIME_RULES.temporary.maxUses - used : 3);
  }
  return out;
}
