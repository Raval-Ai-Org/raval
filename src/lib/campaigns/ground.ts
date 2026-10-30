// The model proposes, code decides. A plan's words come back from a model;
// before they are stored, every sentence with a figure, date or link the brand
// never gave is dropped (`known` is the caller's grounding check, the same one
// Autopilot's plan uses), any web address other than the campaign's own link
// is removed, and a sentence naming a tracked competitor goes. Ids, dates,
// channels and formats come only from the skeleton.
// Pure: no I/O.
import { withoutUnknownFacts } from "@/lib/autopilot/brief";
import type { CampaignPiece } from "./contracts";

export type GroundOptions = {
  /** True when a sentence's facts are all in the brief or brand context. */
  known: (sentence: string) => boolean;
  /** The campaign's link: the only address a piece may carry. */
  link: string | null;
  /** Names that must never appear. */
  competitors: readonly string[];
};

const URL_RE = /\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+/gi;
const LIST_REF = /\(?\b(?:piece|slot|item)\s*\[?\d+\]?\)?/gi;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One field of model text, made safe to store. */
export function groundText(value: unknown, max: number, opts: GroundOptions): string {
  if (typeof value !== "string") return "";
  let text = value.replace(/\s+/g, " ").trim();
  text = text.replace(URL_RE, (url) => (opts.link && url.startsWith(opts.link) ? url : ""));
  text = text.replace(LIST_REF, "");
  const names = opts.competitors.map((n) => n.trim()).filter((n) => n.length >= 3);
  if (names.length) {
    const rival = new RegExp(`\\b(?:${names.map(escape).join("|")})\\b`, "i");
    const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [];
    text = sentences.filter((s) => !rival.test(s)).join("");
  }
  const known = (sentence: string) =>
    opts.known(opts.link ? sentence.split(opts.link).join("") : sentence);
  text = withoutUnknownFacts(text, known).text;
  return text
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, max);
}

export type WrittenPlan = { bigIdea: string; pieces: CampaignPiece[]; dropped: number };

/**
 * Lay the model's words onto the skeleton. Unknown ids are ignored; a piece
 * the person edited keeps their words; a piece the model skipped keeps a
 * plain title from its phase so nothing is left blank.
 */
export function groundCampaignPlan(
  raw: unknown,
  skeleton: readonly CampaignPiece[],
  phaseLabels: Record<string, string>,
  opts: GroundOptions,
): WrittenPlan {
  const out = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const items = Array.isArray(out.pieces) ? out.pieces : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id === "string" && !byId.has(row.id)) byId.set(row.id, row);
  }
  let dropped = 0;
  const pieces = skeleton.map((piece) => {
    if (piece.edited) return piece;
    const row = byId.get(piece.id);
    const title = groundText(row?.title, 120, opts);
    const idea = groundText(row?.idea, 700, opts);
    const visual = groundText(row?.visual, 300, opts);
    if (!title || idea.length < 20) dropped++;
    return {
      ...piece,
      title:
        title ||
        `${phaseLabels[piece.phase] ?? "Campaign"} ${piece.format === "story" ? "Story" : "post"}`,
      idea: idea.length >= 20 ? idea : piece.idea,
      visual: visual || piece.visual,
    };
  });
  return { bigIdea: groundText(out.bigIdea, 300, opts), pieces, dropped };
}
