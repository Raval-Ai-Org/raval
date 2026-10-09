// Why a post gets passed on, written down once. Studio's prompts, Autopilot's
// weekly plan and the calendar planner all read this file, so a piece planned
// in one place is written to the same rules as a piece made in another.
//
// Two layers:
//   - the aim: the one reason a stranger would keep, send or answer this piece.
//     It is chosen per piece and rotated across a week, so a profile is never a
//     row of the same kind of post;
//   - the rules: what every piece needs whatever its aim.
// Nothing here promises reach. It removes the common reasons a post is ignored.
// Pure and browser-safe.
import type { PlatformId } from "@/lib/social-platforms";
import type { StudioType } from "./formats";

export type ShareAimId = "save" | "send" | "reply" | "relate" | "act";

export type ShareAim = { id: ShareAimId; label: string; directive: string };

export const SHARE_AIMS: readonly ShareAim[] = [
  {
    id: "save",
    label: "Worth saving",
    directive:
      "Make it something the reader keeps to use later: a method, a checklist, a rule of thumb. Complete enough to act on with nothing else open.",
  },
  {
    id: "send",
    label: "Worth sending",
    directive:
      "Make it something the reader sends to one particular person: it names a situation that person is in and says it better than they could.",
  },
  {
    id: "reply",
    label: "Worth answering",
    directive:
      "Make it something the reader has an answer to: a real choice, a view people split on, or a question only they can answer. Answerable in a few words.",
  },
  {
    id: "relate",
    label: "That is me",
    directive:
      "Make the reader recognise themselves: one small true moment from their day, described exactly. No lesson forced onto the end.",
  },
  {
    id: "act",
    label: "A clear next step",
    directive:
      "Show the problem, show what solves it, and ask for one small step. One offer, said plainly, with no invented urgency.",
  },
];

export function shareAim(id: unknown): ShareAim | null {
  return SHARE_AIMS.find((a) => a.id === id) ?? null;
}

/** How often each aim should come up for a goal, relative to the others. */
const AIM_MIX: Record<string, Partial<Record<ShareAimId, number>>> = {
  awareness: { send: 3, save: 2, relate: 2, reply: 1 },
  engagement: { reply: 3, relate: 3, send: 1, save: 1 },
  leads: { save: 3, act: 2, send: 1, reply: 1 },
  sales: { act: 3, save: 2, relate: 1, send: 1 },
  trust: { save: 3, relate: 2, send: 1, reply: 1 },
  launch: { act: 2, send: 2, reply: 2, relate: 1 },
};

/**
 * Smooth weighted round-robin: each id comes up in proportion to its weight
 * and never several times in a row while another is due. `offset` skips ahead,
 * so one week does not start the way the last one did.
 */
export function weightedSequence<T extends string>(
  weights: Partial<Record<T, number>>,
  count: number,
  offset = 0,
): T[] {
  const ids = (Object.keys(weights) as T[]).filter((id) => (weights[id] ?? 0) > 0);
  if (!ids.length || count <= 0) return [];
  const total = ids.reduce((sum, id) => sum + (weights[id] ?? 0), 0);
  const current = ids.map(() => 0);
  const out: T[] = [];
  const skip = Math.max(0, Math.floor(offset));
  for (let i = 0; i < skip + count; i++) {
    let best = 0;
    for (let t = 0; t < ids.length; t++) {
      current[t] += weights[ids[t]] ?? 0;
      if (current[t] > current[best]) best = t;
    }
    current[best] -= total;
    if (i >= skip) out.push(ids[best]);
  }
  return out;
}

/** The aim of each piece in a run of `count`, for a goal. */
export function aimSequence(goal: string, count: number, offset = 0): ShareAim[] {
  const mix = AIM_MIX[goal] ?? AIM_MIX.awareness;
  return weightedSequence(mix, count, offset).map((id) => shareAim(id) ?? SHARE_AIMS[0]);
}

/** When each format is the right one, in the words a planner needs. */
export const FORMAT_WHEN: Partial<Record<StudioType, string>> = {
  carousel:
    "the idea has parts: steps, a list, a comparison, myths one by one. People swipe it and save it",
  image: "one picture carries it: a product, a place, a result, one bold line",
  video: "it has to be seen moving: a demonstration, a before and after, a reaction",
  social: "the words are the point: an opinion, a short true story, a question",
  story: "it is about today: a quick tip, a look behind the scenes, a question to answer",
  article: "it answers a question people search for and needs room to do it properly",
};

/** One line per format, for a prompt that lets the model choose between them. */
export function formatGuide(types: readonly string[]): string {
  return [...new Set(types)]
    .map((type) => {
      const when = FORMAT_WHEN[type as StudioType];
      return when ? `- ${type}: when ${when}.` : "";
    })
    .filter(Boolean)
    .join("\n");
}

const VISUAL: readonly StudioType[] = ["image", "carousel", "video", "story"];
const SEARCHED: readonly PlatformId[] = ["instagram", "tiktok", "youtube"];

/** What every piece needs before it is worth posting, whatever its aim. */
export function shareRules(type: StudioType, platforms: readonly PlatformId[] = []): string[] {
  const rules = [
    "Decide first why a stranger would keep it, send it or answer it. With no reason, change the idea, not the wording.",
    "The opening is a promise and the rest keeps it. Never open on the brand's name, a greeting, or how excited anyone is.",
    "Be specific: a named situation, a real example, a figure that is in the context. A general statement is skipped.",
    "One idea. Everything that does not serve it is cut.",
    "Ask for one action that fits the piece (save it, send it to someone, answer one thing, follow a link). Never several.",
    "No bait: no 'comment YES', no 'you won't believe', no pretend deadline. It gets a post hidden and costs trust.",
  ];
  if (VISUAL.includes(type)) {
    rules.push(
      "It has to make sense with the sound off and the caption unread: the picture or the first frame says the point.",
    );
  }
  if (platforms.some((p) => SEARCHED.includes(p))) {
    rules.push(
      "People find posts here by searching: say the topic in the plain words they would type, in the first line.",
    );
  }
  return rules;
}

/** The rules as prompt lines. */
export function shareSection(type: StudioType, platforms: readonly PlatformId[] = []): string {
  // An article is found by search and read at length; these are rules for a feed.
  if (type === "article") return "";
  return shareRules(type, platforms)
    .map((rule) => `- ${rule}`)
    .join("\n");
}

/** The line a brief carries so the writer knows what the piece is for. */
export function aimLine(aim: ShareAim | null | undefined): string {
  return aim ? `What this piece is for: ${aim.label.toLowerCase()}. ${aim.directive}` : "";
}

/**
 * The angles that serve each aim. Studio still rotates so two pieces don't take
 * the same angle, but only among the ones that do what the piece is for: a
 * piece meant to be saved is never written as a hot take.
 */
export const AIM_ANGLES: Record<ShareAimId, readonly string[]> = {
  save: ["how-to", "checklist", "myth", "comparison"],
  send: ["story", "comparison", "contrarian", "data"],
  reply: ["contrarian", "objection", "myth"],
  relate: ["story", "behind-scenes"],
  act: ["proof", "objection", "comparison"],
};
