// The brand's style bible (ADR-0048): the model proposes it from the brand's
// own posts and website, pure code decides what is kept, which pictures are
// sent as examples and what every image prompt is told. Browser-safe.
import {
  referenceFitsFormat,
  type StyleBible,
  type VisualDirection,
  type VisualProfile,
  type VisualSource,
} from "./contracts";

/** Rules for the prompt stay short: they sit in the MUST FOLLOW block of every picture. */
export const BIBLE_RULES_LIMIT = 1100;
/** A recurring subject is only real when the brand shows it more than once. */
export const SUBJECT_MIN_SOURCES = 2;
/** Of the four reference slots, this many are kept for the brand's own style examples. */
export const ANCHOR_SLOTS = 2;
export const MAX_REFERENCE_SLOTS = 4;

const ANCHOR_ROLES = new Set(["artwork", "photo", "type"]);

type Role = VisualProfile["roles"][number]["role"];

/**
 * Keep only what the analysed pictures support:
 * - every id must be one the model was really shown;
 * - examples (anchors) are never UI crops or page overviews: those teach the
 *   image model to draw web pages, not the brand's artwork;
 * - a recurring subject needs `SUBJECT_MIN_SOURCES` of the brand's own pictures
 *   (an inspiration post of another brand never counts);
 * - an empty bible (nothing observed) is dropped.
 */
export function groundBible(
  bible: StyleBible | undefined,
  args: { analysed: Set<string>; roles: Map<string, Role>; ownIds: Set<string> },
): StyleBible | undefined {
  if (!bible) return undefined;
  const seen = (ids: string[]) => ids.filter((id) => args.analysed.has(id));
  const signatures = bible.signatures
    .map((s) => ({ ...s, sourceIds: seen(s.sourceIds) }))
    .filter((s) => s.sourceIds.length > 0);
  const subjectIds = bible.recurringSubject
    ? seen(bible.recurringSubject.sourceIds).filter((id) => args.ownIds.has(id))
    : [];
  const recurringSubject =
    bible.recurringSubject?.description && subjectIds.length >= SUBJECT_MIN_SOURCES
      ? { description: bible.recurringSubject.description, sourceIds: subjectIds }
      : undefined;
  const anchors = seen(bible.anchors).filter((id) => {
    const role = args.roles.get(id);
    return !role || ANCHOR_ROLES.has(role);
  });
  const kept: StyleBible = {
    ...bible,
    signatures,
    recurringSubject,
    anchors,
    components: bible.components.filter((c) => c.description),
  };
  const said = [
    kept.world.medium,
    kept.world.rendering,
    kept.world.setting,
    kept.type.headline,
    kept.composition.headlineZone,
  ].some(Boolean);
  return said || signatures.length || kept.components.length || kept.frame ? kept : undefined;
}

/** Ground every direction of a fresh profile, strongest first. */
export function groundProfile(
  profile: VisualProfile,
  args: { analysed: Set<string>; ownIds: Set<string> },
): VisualProfile {
  const roles = new Map(
    profile.roles.filter((r) => args.analysed.has(r.sourceId)).map((r) => [r.sourceId, r.role]),
  );
  const directions = profile.directions
    .map((d) => {
      const bible = groundBible(d.bible, { ...args, roles });
      // Activation approves exactly the direction's sources: anchors must be among them.
      const sourceIds = [...new Set([...(bible?.anchors ?? []), ...d.sourceIds])].slice(0, 12);
      return { ...d, bible, sourceIds };
    })
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (b.d.confidence ?? 0) - (a.d.confidence ?? 0) || a.i - b.i)
    .map(({ d }) => d);
  return {
    ...profile,
    roles: [...roles].map(([sourceId, role]) => ({ sourceId, role })),
    directions,
    selected: 0,
  };
}

const EMPHASIS_LINE: Record<StyleBible["type"]["emphasis"], string> = {
  "italic-accent":
    "set the one key word or phrase of the headline in italics of the same typeface, in the brand's accent colour",
  "colour-word": "set the one key word in the brand's accent colour, same size and weight",
  "colour-words":
    "set the headline in the base colour with its key words (one or two per line, never all) in the brand's accent colour, same size and weight",
  weight: "contrast a light weight with a heavy one; no colour change",
  none: "",
};

/** The emphasis this brand uses, or null when the bible doesn't say. */
export function bibleEmphasis(bible: StyleBible | undefined): string | null {
  return bible ? EMPHASIS_LINE[bible.type.emphasis] || null : null;
}

const LOGO_LINE: Record<StyleBible["composition"]["logo"], string> = {
  "top-centre": "the wordmark sits centred at the top",
  "top-left": "the wordmark sits top left",
  "top-right": "the wordmark sits top right",
  "bottom-centre": "the wordmark sits centred at the bottom",
  "bottom-left": "the wordmark sits bottom left",
  "bottom-right": "the wordmark sits bottom right",
  none: "",
};

const LOGO_SHARE: Record<StyleBible["logo"], number> = {
  always: 1,
  often: 0.75,
  sometimes: 0.5,
  rarely: 0.2,
};

/**
 * Whether this picture carries the logo. Not every post needs it: the brand's
 * own habit decides, deterministically per piece (the same seed always gives
 * the same answer, so a retry or redo keeps it). No bible: the logo is placed.
 */
export function bibleWantsLogo(direction: VisualDirection | undefined, seed: string): boolean {
  const use = direction?.bible?.logo;
  if (!use || use === "always") return true;
  let h = 2166136261;
  for (const ch of `logo:${seed}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000 < LOGO_SHARE[use];
}

/** A brand whose posts carry a headline plus supporting lines (eyebrow, list, buttons). */
export function bibleRichText(direction: VisualDirection | undefined): boolean {
  return direction?.bible?.text === "rich";
}

/**
 * Whether a picture gets supporting lines (eyebrow, body, items, button) beside
 * its headline: a rich-text brand always, and every campaign piece, whose
 * eyebrow is the campaign's name. A brand that keeps its pictures word-free
 * (`text: "minimal"`) never does.
 */
export function wantsSupportingLines(
  direction: VisualDirection | undefined,
  campaign?: string | null,
): boolean {
  if (direction?.bible?.text === "minimal") return false;
  return bibleRichText(direction) || !!campaign?.trim();
}

/** Where the bible puts the logo, as the overlay's corner when it names one. */
export function bibleLogoPlace(direction: VisualDirection | undefined) {
  return direction?.bible?.composition.logo ?? "none";
}

const clip = (s: string, max = 220) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * What every picture of the brand is told. Light keeps Mellox's own layouts and
 * only fixes the world and type; Close adds the composition; Strict also asks
 * for the examples' framing. Capped at `BIBLE_RULES_LIMIT`.
 */
export function bibleRules(direction: VisualDirection, opts: { hasText?: boolean } = {}): string {
  const b = direction.bible;
  if (!b) return "";
  const level = direction.adherence;
  const world = [
    b.world.medium,
    b.world.rendering,
    b.world.setting,
    b.world.lighting,
    b.world.paletteMood,
  ]
    .filter(Boolean)
    .join("; ");
  const lines: string[] = [
    `BRAND STYLE BIBLE (${direction.name}). Every picture of this brand belongs to one recognisable world.`,
    world ? `World: ${clip(world, 420)}.` : "",
    b.signatures.length
      ? `Signature elements (use one or two where they fit, never all): ${b.signatures
          .slice(0, 4)
          .map((s) => clip(s.description, 120))
          .join(" | ")}.`
      : "",
    b.recurringSubject
      ? `Recurring figure: ${clip(b.recurringSubject.description, 200)}. It may appear when the idea suits it (about half the pictures), always the same design, never a real person.`
      : "",
  ];
  if (b.register === "designed-system")
    lines.push(
      "Medium: a clean designed graphic (flat vector, crisp type, real photos or screens placed in frames), never a painted or 3D scene unless the examples show one.",
    );
  if (b.frame)
    lines.push(`Series frame (keep on every picture of the series): ${clip(b.frame, 260)}.`);
  if (b.components.length)
    lines.push(
      `Building blocks this brand reuses (pick the two or three this idea needs): ${b.components
        .slice(0, 6)
        .map((c) => clip(c.description, 90))
        .join(" | ")}.`,
    );
  if (opts.hasText !== false && (b.type.headline || b.type.emphasis !== "none")) {
    const emphasis = bibleEmphasis(b);
    lines.push(
      `Type: ${clip(b.type.headline || "the brand's headline face", 160)}${b.type.casing ? `, ${b.type.casing}` : ""}.${emphasis ? ` Emphasis (overrides the general emphasis rule): ${emphasis}.` : ""}`,
    );
  }
  if (level !== "light") {
    const logo = LOGO_LINE[b.composition.logo];
    const parts = [
      logo,
      b.composition.headlineZone && `headline ${clip(b.composition.headlineZone, 120)}`,
      b.composition.subjectZone && `subject ${clip(b.composition.subjectZone, 120)}`,
      `${b.composition.density} density`,
    ].filter(Boolean);
    lines.push(`Composition: ${parts.join("; ")}.`);
  }
  if (level === "strict")
    lines.push(
      "Follow the attached examples' framing and layout closely; change only the subject and the words.",
    );
  else
    lines.push(
      "Keep the world, palette and type; compose this picture freshly for its own idea. Never trace an example.",
    );
  if (b.avoid.length)
    lines.push(
      `Never: ${b.avoid
        .slice(0, 4)
        .map((a) => clip(a, 100))
        .join("; ")}.`,
    );
  let out = lines.filter(Boolean).join("\n");
  while (out.length > BIBLE_RULES_LIMIT && lines.length > 3) {
    // Drop from the end, keeping the world and type first.
    lines.splice(lines.length - 2, 1);
    out = lines.filter(Boolean).join("\n");
  }
  return out.slice(0, BIBLE_RULES_LIMIT);
}

/**
 * The reference images for one picture: up to `ANCHOR_SLOTS` of the bible's own
 * examples first (the brand's style must always be shown), then product and
 * person photos, then other approved references. Never an Avoid, never a
 * source outside the format or campaign.
 */
export function pickAnchors(
  sources: VisualSource[],
  args: {
    direction: VisualDirection;
    format: string;
    campaign?: string;
    weights?: Record<string, number>;
    limit?: number;
  },
): VisualSource[] {
  const limit = Math.min(MAX_REFERENCE_SLOTS, Math.max(0, args.limit ?? MAX_REFERENCE_SLOTS));
  const allowed = new Set(args.direction.sourceIds);
  const usable = sources.filter(
    (s) =>
      s.status === "approved" &&
      s.purpose !== "avoid" &&
      s.asset?.mime_type.startsWith("image/") &&
      s.region.type !== "full" &&
      referenceFitsFormat(s.formats, args.format) &&
      (!s.campaign || s.campaign === args.campaign) &&
      (s.kind !== "website" || allowed.has(s.id)),
  );
  const weight = (s: VisualSource) => Math.max(-3, Math.min(3, args.weights?.[s.id] ?? 0));
  const anchorOrder = args.direction.bible?.anchors ?? [];
  const anchors = anchorOrder
    .map((id) => usable.find((s) => s.id === id))
    .filter((s): s is VisualSource => !!s && weight(s) > -2)
    .slice(0, ANCHOR_SLOTS);
  const rest = usable
    .filter((s) => !anchors.includes(s))
    .sort((a, b) => {
      const priority = (s: VisualSource) =>
        (s.purpose === "product" || s.purpose === "person" ? 20 : 0) +
        (allowed.has(s.id) ? 10 : 0) +
        weight(s);
      return priority(b) - priority(a) || a.id.localeCompare(b.id);
    });
  return [...anchors, ...rest].slice(0, limit);
}
