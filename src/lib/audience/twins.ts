// Audience groups: seeding from Brand DNA, merging without losing what a person
// wrote, and the text a prompt gets. Pure.
import {
  MAX_PANEL_TWINS,
  MAX_TRAITS,
  MAX_TWINS,
  OVERALL_SLUG,
  type Trait,
  type TraitKind,
  type TraitSource,
  type TwinRow,
  type TwinView,
} from "./contracts";
import { normalizeText, stableHash } from "./hash";

export type TwinDraft = {
  slug: string;
  name: string;
  segment: string;
  summary: string;
  weight: number;
  profile: Trait[];
  origin: TwinRow["origin"];
  origin_ref: string | null;
};

export const SOURCE_LABEL: Record<TraitSource, string> = {
  user: "You told us",
  brand_dna: "From your Brand DNA",
  website: "From your website",
  market: "From your market",
  competitor: "From competitors",
  measured: "Measured from your posts",
  assumed: "Our guess",
};

export const KIND_LABEL: Record<TraitKind, string> = {
  goal: "Wants",
  pain: "Struggles with",
  objection: "Holds back because",
  trigger: "Acts when",
  channel: "Spends time on",
  language: "Talks like",
  pattern: "Responds to",
};

/** How far to trust each source before any real result says otherwise. */
export const SOURCE_CONFIDENCE: Record<TraitSource, number> = {
  user: 0.9,
  measured: 0.85,
  brand_dna: 0.7,
  website: 0.6,
  market: 0.5,
  competitor: 0.45,
  assumed: 0.3,
};

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!slug) return `group-${stableHash(name).slice(0, 8)}`;
  return slug === OVERALL_SLUG ? "overall-group" : slug;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** "a; b\nc" and bullet lists become separate short statements. */
export function splitStatements(text: string | null | undefined, max = 4): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n|;|•|•|(?<=\.)\s+(?=[A-Z])/)
    .map((part) => part.replace(/^[\s\-*\d.)]+/, "").trim())
    .filter((part) => part.length >= 3)
    .map((part) => clip(part, 280))
    .slice(0, max);
}

export function makeTrait(kind: TraitKind, text: string, source: TraitSource, url?: string): Trait {
  const clean = clip(text, 280);
  return {
    id: stableHash(`${kind}:${normalizeText(clean)}`).slice(0, 12),
    kind,
    text: clean,
    source,
    confidence: SOURCE_CONFIDENCE[source],
    ...(url ? { url } : {}),
  };
}

function traitsFrom(kind: TraitKind, text: string | undefined, source: TraitSource, max = 3) {
  return splitStatements(text, max).map((statement) => makeTrait(kind, statement, source));
}

/** Same statement, whatever its source or punctuation. */
function traitKey(trait: Pick<Trait, "kind" | "text">): string {
  return `${trait.kind}:${normalizeText(trait.text).replace(/[^a-z0-9 ]/g, "")}`;
}

export function dedupeTraits(traits: Trait[]): Trait[] {
  const seen = new Map<string, Trait>();
  for (const trait of traits) {
    const key = traitKey(trait);
    const held = seen.get(key);
    // The better-sourced copy wins.
    if (!held || trait.confidence > held.confidence) seen.set(key, trait);
  }
  return [...seen.values()];
}

type DnaPersona = {
  id?: string;
  name?: string;
  role?: string;
  segment?: string;
  goals?: string;
  painPoints?: string;
  objections?: string;
  channels?: string;
};

type DnaLike = {
  audience?: string;
  audienceTags?: string[];
  customer?: {
    jobsToBeDone?: string;
    painPoints?: string;
    objections?: string;
    buyingTriggers?: string;
    channels?: string;
    personas?: DnaPersona[];
  };
};

/**
 * Groups straight from Brand DNA, with no model call: one per customer entry,
 * or one "Your audience" group from the audience description. Empty when Brand
 * DNA says nothing about who the brand is for.
 */
export function seedFromBrandDna(dna: DnaLike | null | undefined): TwinDraft[] {
  if (!dna) return [];
  const customer = dna.customer ?? {};
  const shared: Trait[] = [
    ...traitsFrom("goal", customer.jobsToBeDone, "brand_dna", 2),
    ...traitsFrom("pain", customer.painPoints, "brand_dna", 2),
    ...traitsFrom("objection", customer.objections, "brand_dna", 2),
    ...traitsFrom("trigger", customer.buyingTriggers, "brand_dna", 2),
    ...traitsFrom("channel", customer.channels, "brand_dna", 2),
  ];
  const personas = (customer.personas ?? []).filter((p) => p?.name?.trim()).slice(0, MAX_TWINS);

  if (personas.length) {
    const used = new Set<string>();
    return personas.map((persona) => {
      let slug = slugify(persona.name!);
      while (used.has(slug)) slug = `${slug.slice(0, 56)}-${used.size + 1}`;
      used.add(slug);
      const own: Trait[] = [
        ...traitsFrom("goal", persona.goals, "brand_dna"),
        ...traitsFrom("pain", persona.painPoints, "brand_dna"),
        ...traitsFrom("objection", persona.objections, "brand_dna"),
        ...traitsFrom("channel", persona.channels, "brand_dna"),
      ];
      return {
        slug,
        name: clip(persona.name!, 80),
        segment: clip([persona.role, persona.segment].filter(Boolean).join(" · "), 120),
        summary: "",
        weight: Math.max(1, Math.round(100 / personas.length)),
        profile: dedupeTraits([...own, ...shared]).slice(0, MAX_TRAITS),
        origin: "brand_dna" as const,
        origin_ref: persona.id ?? null,
      };
    });
  }

  const audience = (dna.audience ?? "").trim();
  const tags = (dna.audienceTags ?? []).filter(Boolean).slice(0, 6);
  if (!audience && !tags.length && !shared.length) return [];
  return [
    {
      slug: "your-audience",
      name: "Your audience",
      segment: clip(tags.join(", "), 120),
      summary: clip(audience, 600),
      weight: 100,
      profile: shared.slice(0, MAX_TRAITS),
      origin: "brand_dna",
      origin_ref: null,
    },
  ];
}

/**
 * Bring new traits into a group. What a person wrote always stays; measured
 * traits are only replaced by newer measured ones; everything else is replaced
 * by the incoming set. Result is capped, best-sourced first.
 */
export function mergeTraits(existing: Trait[], incoming: Trait[]): Trait[] {
  const fromUser = existing.filter((t) => t.source === "user");
  const measuredIn = incoming.filter((t) => t.source === "measured");
  const measured = measuredIn.length ? measuredIn : existing.filter((t) => t.source === "measured");
  const rest = incoming.filter((t) => t.source !== "user" && t.source !== "measured");
  const kept = rest.length
    ? rest
    : existing.filter((t) => t.source !== "user" && t.source !== "measured");
  return dedupeTraits([...fromUser, ...measured, ...kept])
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_TRAITS);
}

/**
 * The same statements from the same sources, whatever order they or their
 * fields are stored in (Postgres does not keep JSON key order).
 */
export function sameTraits(a: Trait[], b: Trait[]): boolean {
  const key = (list: Trait[]) =>
    list
      .map((t) => `${t.kind}␟${t.source}␟${t.text}␟${t.url ?? ""}`)
      .sort()
      .join("␞");
  return a.length === b.length && key(a) === key(b);
}

/** A person's edit: their traits become `user`; untouched ones keep their source. */
export function applyUserTraits(
  existing: Trait[],
  edited: { id?: string; kind: TraitKind; text: string }[],
): Trait[] {
  const byId = new Map(existing.map((t) => [t.id, t]));
  const out: Trait[] = [];
  for (const row of edited) {
    const held = row.id ? byId.get(row.id) : undefined;
    if (held && held.kind === row.kind && normalizeText(held.text) === normalizeText(row.text)) {
      out.push(held);
    } else {
      out.push(makeTrait(row.kind, row.text, "user"));
    }
  }
  // Measured patterns are not a person's to delete by omission.
  const measured = existing.filter((t) => t.source === "measured");
  return dedupeTraits([...out, ...measured]).slice(0, MAX_TRAITS);
}

/** 0-100: the share of a group that is known rather than guessed. */
export function knownShare(traits: Trait[]): number {
  if (!traits.length) return 0;
  const total = traits.reduce((sum, t) => sum + t.confidence, 0);
  return Math.round((total / traits.length) * 100);
}

export function presentTwin(row: TwinRow): TwinView {
  const traits = Array.isArray(row.profile) ? row.profile : [];
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    name: row.name,
    segment: row.segment,
    summary: row.summary,
    weight: row.weight,
    traits,
    origin: row.origin,
    known: knownShare(traits),
    updatedAt: row.updated_at,
  };
}

type TwinLike = Pick<
  TwinRow,
  "id" | "slug" | "kind" | "name" | "segment" | "summary" | "weight"
> & {
  profile: Trait[];
  version?: number;
  status?: string;
};

/** The groups that answer a check: active, real groups, biggest first. */
export function panelTwins<T extends TwinLike>(twins: T[]): T[] {
  return twins
    .filter((t) => t.kind === "group" && (t.status ?? "active") === "active")
    .sort((a, b) => b.weight - a.weight || a.slug.localeCompare(b.slug))
    .slice(0, MAX_PANEL_TWINS);
}

/** Changes whenever the audience that would answer changes. */
export function twinsFingerprint(twins: TwinLike[]): string {
  const parts = [...twins]
    .filter((t) => (t.status ?? "active") === "active")
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((t) => `${t.slug}:${t.version ?? 1}:${t.weight}`);
  return stableHash(parts.join("|") || "none");
}

/** One group as a prompt sees it. Guesses are marked so the model weighs them less. */
export function twinBrief(twin: TwinLike, maxChars = 900): string {
  const lines = [`${twin.name}${twin.segment ? ` (${twin.segment})` : ""}`];
  if (twin.summary) lines.push(twin.summary);
  for (const trait of twin.profile) {
    const guess = trait.source === "assumed" ? " (a guess)" : "";
    const measured = trait.source === "measured" ? " (measured)" : "";
    lines.push(`- ${KIND_LABEL[trait.kind]}: ${trait.text}${guess}${measured}`);
  }
  const text = lines.join("\n");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

/**
 * The compact block generators get, so a caption is written for real groups
 * rather than "a general audience". Empty when there are no groups.
 */
export function audienceBlock(twins: TwinLike[], maxChars = 1200): string {
  const groups = panelTwins(twins);
  const overall = twins.find((t) => t.kind === "overall");
  if (!groups.length && !overall?.profile.length) return "";
  const lines: string[] = ["## Who this is for"];
  for (const twin of groups.slice(0, 4)) {
    const pick = (kind: TraitKind) =>
      twin.profile
        .filter((t) => t.kind === kind)
        .slice(0, 2)
        .map((t) => t.text)
        .join("; ");
    const bits = [
      pick("goal") && `wants ${pick("goal")}`,
      pick("pain") && `struggles with ${pick("pain")}`,
      pick("objection") && `holds back because ${pick("objection")}`,
    ].filter(Boolean);
    lines.push(
      `- ${twin.name}${twin.segment ? ` (${twin.segment})` : ""}${bits.length ? `: ${bits.join(". ")}` : ""}`,
    );
  }
  const measured = (overall?.profile ?? []).filter((t) => t.source === "measured").slice(0, 3);
  if (measured.length) {
    lines.push("What their real reactions show:");
    for (const trait of measured) lines.push(`- ${trait.text}`);
  }
  const text = lines.join("\n");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trimEnd()}…`;
}
