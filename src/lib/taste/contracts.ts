// The brand's taste (ADR-0038): what its team loved in the Library, or wanted
// less of, as counts per creative choice. Pure and browser-safe.

/** The creative choices Studio records on a piece, by the id it stores. */
export const TRAIT_KINDS = [
  "format",
  "platform",
  "aim",
  "hook",
  "angle",
  "adFormat",
  "layout",
  "colorway",
  "motif",
  "structure",
  "storyTheme",
  "ratio",
] as const;

export type TraitKind = (typeof TRAIT_KINDS)[number];
export type Traits = Partial<Record<TraitKind, string>>;

export type Reaction = "love" | "less";
export const REACTIONS: readonly Reaction[] = ["love", "less"];

/** Values a picker should lean toward, and values it should leave out. */
export type Lean = { liked: string[]; avoided: string[] };

export type Taste = {
  loves: number;
  lesses: number;
  lean: Partial<Record<TraitKind, Lean>>;
};

/** A learned preference, in plain words, for the Library's taste strip. */
export type TasteChip = {
  kind: TraitKind;
  value: string;
  label: string;
  tone: "liked" | "avoided";
};

export type TasteSummary = {
  loves: number;
  lesses: number;
  chips: TasteChip[];
  /** Loves still needed before anything is learned; 0 once something is. */
  toLearn: number;
};

/** What the Library reads: every heart by subject, and what was learned. */
export type TasteView = {
  /** subject key → reaction. Posts are keyed by group id, media by asset id. */
  reactions: Record<string, Reaction>;
  summary: TasteSummary;
};

/**
 * Honest thresholds: a choice counts as liked only after two loved posts used
 * it (and more loves than lesses), as avoided only after two "less like this".
 * The same rule as Autopilot's learnings: no pattern from a single post.
 */
export const MIN_LOVES = 2;
export const MIN_LESSES = 2;
/** Only the newest reactions are read. */
export const TASTE_WINDOW = 200;

export const EMPTY_TASTE: Taste = { loves: 0, lesses: 0, lean: {} };

export function isReaction(value: unknown): value is Reaction {
  return value === "love" || value === "less";
}
