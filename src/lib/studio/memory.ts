// Content memory: what this workspace has already made, turned into what the
// next piece must not repeat and what it should stay consistent with.
//
// Two different things are kept apart on purpose:
//   - the idea, the opening and the structure must be NEW each time;
//   - the voice and the look must stay the SAME, so a profile reads as one brand.
// Pure and browser-safe.
import type { StudioContext } from "./prompts";

export type HookStyle = { id: string; label: string; directive: string };

/** Ways to open a piece. Rotated so two posts in a row never start the same way. */
export const HOOK_STYLES: HookStyle[] = [
  {
    id: "question",
    label: "A question",
    directive: "Open with a specific question the reader is already asking themselves.",
  },
  {
    id: "claim",
    label: "A plain claim",
    directive: "Open with one confident statement that some readers will want to push back on.",
  },
  {
    id: "scene",
    label: "A moment",
    directive: "Open in the middle of a small, concrete moment: a place, an action, a detail.",
  },
  {
    id: "contrast",
    label: "A contrast",
    directive: "Open by setting what most people do against what works better.",
  },
  {
    id: "result",
    label: "The result first",
    directive: "Open with the outcome, then explain how it came about.",
  },
  {
    id: "callout",
    label: "Naming the reader",
    directive: "Open by naming exactly who this is for and the situation they are in.",
  },
  {
    id: "mistake",
    label: "A common mistake",
    directive: "Open with a mistake the reader is probably making without knowing it.",
  },
  {
    id: "lesson",
    label: "A lesson learned",
    directive: "Open with something the brand got wrong or learned the hard way, stated honestly.",
  },
  {
    id: "howto",
    label: "A how-to promise",
    directive: "Open by promising one specific thing the reader will be able to do after reading.",
  },
];

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** An opening style the workspace hasn't used in its last few pieces. */
export function pickHookStyle(
  seed: string,
  recent: (string | null | undefined)[],
  preferred?: string | null,
): HookStyle {
  const kept = preferred ? HOOK_STYLES.find((h) => h.id === preferred) : null;
  if (kept) return kept;
  const used = new Set(recent.filter(Boolean).slice(0, 5));
  const pool = HOOK_STYLES.filter((h) => !used.has(h.id));
  const candidates = pool.length ? pool : HOOK_STYLES;
  return candidates[hash(`hook:${seed}`) % candidates.length];
}

/** The first line a reader sees: the first non-empty line, without hashtags. */
export function openingLine(text: string | null | undefined): string {
  const line =
    (text ?? "")
      .split(/\n+/)
      .map((l) => l.trim())
      .find((l) => l && !/^(#[\p{L}\p{N}_]+\s*)+$/u.test(l)) ?? "";
  return line
    .replace(/^[#>*\-\s]+/, "")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

type Recent = StudioContext["recent"];

function distinct(values: (string | null | undefined)[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const v = (value ?? "").trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

/** What's been leaned on lately, so the next piece goes somewhere else. */
function overused(recent: Recent): string[] {
  const counts = new Map<string, number>();
  for (const r of recent.slice(0, 12)) {
    if (r.angle) counts.set(r.angle, (counts.get(r.angle) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= 3).map(([angle]) => angle);
}

/**
 * The "already made" block for a prompt: openings that are taken and angles
 * that are worn out. Empty when the workspace has made nothing yet.
 */
export function memorySection(recent: Recent): string {
  const openings = distinct(
    recent.map((r) => r.hook),
    10,
  );
  const tired = overused(recent);
  const parts: string[] = [];
  if (openings.length) {
    parts.push(
      `Openings already used. The new piece must not start with the same words, the same sentence shape or the same idea as any of these:\n${openings
        .map((o) => `- ${o}`)
        .join("\n")}`,
    );
  }
  if (tired.length) {
    parts.push(`Angles used a lot lately, so avoid leaning on them again: ${tired.join(", ")}.`);
  }
  return parts.join("\n\n");
}

const LIVE = new Set(["published", "scheduled", "approved", "publishing"]);

/**
 * Up to two pieces the brand actually put out, as a voice reference. These are
 * for how it sounds, never for what it says.
 */
export function voiceSamples(recent: Recent, channel?: string | null): string[] {
  const live = recent.filter((r) => r.status && LIVE.has(r.status) && (r.sample?.length ?? 0) > 60);
  const own = channel ? live.filter((r) => r.channel === channel) : [];
  return distinct(
    [...own, ...live].map((r) => r.sample),
    2,
  );
}

/** The consistency block: sound like the same brand that wrote these. */
export function consistencySection(recent: Recent, channel?: string | null): string {
  const samples = voiceSamples(recent, channel);
  if (!samples.length) return "";
  return `These went out from this brand. Match how they sound: the same person, the same sentence rhythm, the same way of addressing the reader, the same habits with emoji and line breaks. Take nothing else from them: not the topic, not the opening, not the facts.\n${samples
    .map((s, i) => `<published ${i + 1}>\n${s}\n</published>`)
    .join("\n")}`;
}
