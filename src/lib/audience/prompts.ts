// Prompts and answer shapes for the audience model calls. Pure: the server
// wraps anything that came from outside (Brand DNA, the piece itself) as
// untrusted data before it is put into `user`.
import { DIMENSIONS, STANCES, TRAIT_KINDS, type Subject } from "./contracts";

const DIMENSION_PROPS = Object.fromEntries(
  DIMENSIONS.map((key) => [key, { type: "integer" }]),
) as Record<string, { type: "integer" }>;

const DIMENSIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...DIMENSIONS],
  properties: DIMENSION_PROPS,
} as const;

const DIMENSION_GUIDE = `Score each of these from 0 to 100 (50 = ordinary, 80 = clearly strong, 30 = clearly weak):
- "fit": is this about something these people care about, in words they would use?
- "hook": would the first line make them stop?
- "clarity": is it obvious what it says and who it is for?
- "trust": does it sound real and believable to them, not like an advert?
- "cta": is the next step clear and worth taking?
Be a tough, honest reader. Most pieces are ordinary: do not hand out high scores to be kind.`;

export function subjectText(subject: Subject): string {
  const where = subject.platform ? ` for ${subject.platform}` : "";
  const head = [`Type: ${subject.kind}${where}`];
  if (subject.title) head.push(`Title: ${subject.title}`);
  return `${head.join("\n")}\n\n${subject.body}`;
}

/* ───────────────────────── quick score ───────────────────────── */

export const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pieces"],
  properties: {
    pieces: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "dimensions", "why", "fixes"],
        properties: {
          index: { type: "integer" },
          dimensions: DIMENSIONS_SCHEMA,
          why: { type: "string" },
          fixes: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export const SCORE_SYSTEM = `You judge marketing content the way its real audience would, before it is posted.

You get a description of the audience and one or more numbered pieces. For EACH piece return its "index" and:
${DIMENSION_GUIDE}
- "why": one plain sentence on the main reason for the scores, written to the person who made it.
- "fixes": up to 3 short, specific changes that would make these people care more. Each starts with a verb. No generic advice.

Rules:
- Judge only from the audience description. Lines marked "(a guess)" are uncertain: lean on them less.
- Never invent facts about the brand, and never suggest adding a number, result or claim that is not in the piece.
- Everyday words. No jargon.`;

/* ───────────────────────── deeper check ───────────────────────── */

export const REACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dimensions", "people", "likes", "objections"],
  properties: {
    dimensions: DIMENSIONS_SCHEMA,
    people: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["who", "stance", "quote", "wouldAct"],
        properties: {
          who: { type: "string" },
          stance: { type: "string", enum: [...STANCES] },
          quote: { type: "string" },
          wouldAct: { type: "boolean" },
        },
      },
    },
    likes: { type: "array", items: { type: "string" } },
    objections: { type: "array", items: { type: "string" } },
  },
} as const;

export function reactSystem(people: number): string {
  return `You simulate how one group of people reacts to a piece of marketing content when it shows up in their feed.

You get the group and the piece. Imagine ${people} different people from this group: different moods, ages, how busy they are, how much they already know the brand. They are not all positive. Real feeds are full of things people scroll past.

Return:
- "dimensions": the group's view as a whole.
${DIMENSION_GUIDE}
- "people": exactly ${people} entries. "who" is a few words describing the person (no names), e.g. "Busy shop owner, skims on her phone". "stance" is one of love, like, neutral, skip, dislike. "quote" is what they would think or say, in their own words, one sentence. "wouldAct" is true only if they would really do the next step.
- "likes": up to 3 things in the piece this group responds to.
- "objections": up to 3 doubts or reasons this group holds back.

Rules:
- Stay inside what the group description says. Lines marked "(a guess)" are uncertain.
- Never invent facts about the brand or the product.
- Everyday words, the way these people talk.`;
}

export const SYNTH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["why", "fixes"],
  properties: {
    why: { type: "string" },
    fixes: { type: "array", items: { type: "string" } },
  },
} as const;

export const SYNTH_SYSTEM = `You explain to a busy marketer how a simulated audience reacted to their piece.

You get the piece, the scores, and what each group liked and doubted. Return:
- "why": two plain sentences. What worked, what held people back, and whether groups disagreed.
- "fixes": up to 3 specific changes to the piece that answer the biggest doubts. Each starts with a verb and names what to change.

Rules:
- Use only the reactions you were given. Never invent a reaction, a fact about the brand, or a number.
- Everyday words. No jargon. Talk to "you".`;

/* ───────────────────────── comparing versions ───────────────────────── */

export const VARIANTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["versions"],
  properties: {
    versions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "body"],
        properties: {
          label: { type: "string" },
          body: { type: "string" },
        },
      },
    },
  },
} as const;

export function variantsSystem(count: number): string {
  return `You rewrite one piece of marketing content into ${count} versions that each try a clearly different way to reach the same audience.

Each version takes ONE different approach, for example: lead with the problem, lead with the result, tell a short story, ask a question, speak to a doubt, be blunt and short. Different openings, different structure. Not the same post with a few words swapped.

Return "versions": exactly ${count} entries with:
- "label": 2 to 4 words naming the approach (e.g. "Lead with the problem").
- "body": the full rewritten piece, ready to post, about the same length as the original, for the same platform.

Rules:
- Keep every fact, number, name, link, @mention and #hashtag from the original exactly. Never add a new fact, number, result, offer or claim.
- Keep the brand's voice.
- Everyday words. No em dashes.`;
}

export const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["versions"],
  properties: {
    versions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "dimensions", "picks", "reason"],
        properties: {
          index: { type: "integer" },
          dimensions: DIMENSIONS_SCHEMA,
          picks: { type: "integer" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

export function judgeSystem(people: number, versions: number): string {
  return `You simulate how one group of people chooses between ${versions} versions of the same marketing content.

You get the group and the numbered versions. Imagine ${people} different people from this group seeing all of them.

Return "versions": one entry for EVERY version, with:
- "index": the version's number.
- "dimensions": how this group sees that version.
${DIMENSION_GUIDE}
- "picks": how many of the ${people} people would stop for this version over the others. The picks across all versions add up to ${people}.
- "reason": one sentence, in plain words, on why this group reacts to this version the way it does.

Rules:
- Compare the versions with each other honestly. They should not all get the same scores.
- Stay inside what the group description says. Lines marked "(a guess)" are uncertain.
- Never invent facts about the brand.`;
}

export function numberedVersions(
  versions: { label: string; title: string; body: string }[],
): string {
  return versions
    .map((v, i) => `### Version ${i}${v.title ? ` — ${v.title}` : ""}\n${v.body}`)
    .join("\n\n");
}

/* ───────────────────────── building the groups ───────────────────────── */

export const TWINS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["groups"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "segment", "summary", "weight", "traits"],
        properties: {
          name: { type: "string" },
          segment: { type: "string" },
          summary: { type: "string" },
          weight: { type: "integer" },
          traits: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["kind", "text", "basis"],
              properties: {
                kind: { type: "string", enum: [...TRAIT_KINDS] },
                text: { type: "string" },
                basis: {
                  type: "string",
                  enum: ["brand", "market", "competitor", "guess"],
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const TWINS_SYSTEM = `You describe the audience of one brand as 2 to 4 distinct groups of real people, so content can be written and tested for them.

You get the brand's own context, and sometimes notes about its market and its competitors' customers.

Return "groups", most important first. Each has:
- "name": 2 to 4 plain words for the group (e.g. "Busy salon owners"). Not a made-up person's name.
- "segment": a few words on who they are (role, situation).
- "summary": one or two sentences on what their day looks like and why this brand matters to them.
- "weight": this group's rough share of the audience, 1 to 100. The weights add up to about 100.
- "traits": 5 to 8 short statements. "kind" is one of goal, pain, objection, trigger, channel, language, pattern. "text" is one plain sentence. "basis" says where it comes from:
  - "brand": stated in the brand context.
  - "market": supported by the market notes.
  - "competitor": supported by the competitor notes.
  - "guess": your own reasonable assumption. Use this honestly; a guess is fine but must be labelled.

Rules:
- If existing groups are listed, keep their names and improve them rather than inventing new ones.
- Groups must be clearly different from each other.
- Never invent facts about the brand: no products, prices, numbers or customers that are not in the context.
- Everyday words. No jargon.`;
