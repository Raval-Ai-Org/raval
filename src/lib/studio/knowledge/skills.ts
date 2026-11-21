// Specialist marketing skills: the craft of a strategist, copywriter, ad
// specialist and social lead, cut into small pieces a writer can follow.
//
// A skill applies when its `when` matches the piece (category, goal, format,
// ad objective, industry, funnel stage); select.ts gives a piece at most three,
// most specific first, so prompts stay short. Lines are imperative and
// brand-neutral; a skill never adds a fact. Distilled from the Round 5
// research (sources in docs/studio/marketing-knowledge.md). Pure and
// browser-safe. Ids may be stored: add, never rename.
import type { IndustryId } from "./industries";

export type SkillWhen = {
  categories?: readonly string[];
  goals?: readonly string[];
  formats?: readonly string[];
  adObjectives?: readonly string[];
  industries?: readonly IndustryId[];
  stages?: readonly string[];
};

export type Skill = {
  id: string;
  name: string;
  when: SkillWhen;
  /** How to do it: 2-4 short imperative lines. */
  lines: readonly string[];
  /** The check the finished piece must pass. */
  check: string;
};

export const SKILLS: readonly Skill[] = [
  {
    id: "offer-clarity",
    name: "Offer clarity",
    when: { categories: ["sale"], goals: ["offer"], adObjectives: ["sales", "local", "event"] },
    lines: [
      "The offer is the headline, in the brand's exact terms (the figure, the price, the deal); who it is for comes second, the true reason to act now third, one action last.",
      "Anchor with value before price; say 'was' only for a real previous price. Under 100, a % reads stronger; above 100, the amount saved.",
      "Put the action and any real deadline next to each other, once.",
    ],
    check: "Someone glancing for one second can say what is offered, to whom, and what to do.",
  },
  {
    id: "genuine-urgency",
    name: "Genuine urgency",
    when: { categories: ["sale", "launch"], adObjectives: ["sales", "event"], stages: ["convert"] },
    lines: [
      "Urgency only from a real constraint the brand gave: a date, limited places or stock, a season, a bonus that ends. Name it exactly.",
      "With no real constraint, give a true reason that fits now (the season, the occasion, the problem getting worse) instead of a countdown.",
    ],
    check: "Every 'now' reason can be verified from the brief.",
  },
  {
    id: "objection-handling",
    name: "Answer one objection",
    when: {
      adObjectives: ["retarget"],
      stages: ["convince", "convert"],
      categories: ["proof", "this-or-that"],
    },
    lines: [
      "Pick the single doubt most likely to stop this reader (price, will it work for me, effort, switching, trust) and answer only that one.",
      "Answer with the strongest real proof the brand has: how it works, the guarantee only if stated, a customer's own words only if given.",
      "Put the risk reducer (free trial, no card, cancel anytime) beside the action, only if true.",
    ],
    check: "One objection named, one proof given, nothing invented.",
  },
  {
    id: "pain-points",
    name: "Name the pain",
    when: {
      goals: ["leads"],
      adObjectives: ["leads", "app"],
      categories: ["relatable", "myth"],
      stages: ["attract"],
    },
    lines: [
      "Name the exact moment the pain happens, in the customer's own words (the 11pm receipt hunt, not 'bookkeeping challenges').",
      "Say what it costs them in time, money or feeling, honestly; criticise the old way, never the reader.",
    ],
    check: "A reader in that situation thinks 'that is me'.",
  },
  {
    id: "lead-magnet",
    name: "Earn the contact",
    when: { goals: ["leads"], adObjectives: ["leads"] },
    lines: [
      "Offer one specific, low-effort next step the brand really gives (a free trial, a check, a guide, a valuation) and say exactly what they get and when.",
      "Match it to how ready they are: a checklist or tip for the curious, a trial or audit for the ready.",
      "Make the action plain and personal ('Book my free class', 'Get my valuation').",
    ],
    check: "The next step is specific, free of effort words, and really offered.",
  },
  {
    id: "retargeting",
    name: "Win back a visitor",
    when: { adObjectives: ["retarget"] },
    lines: [
      "They already saw the product: don't introduce it again. Lead with a new angle or the proof that answers why they left.",
      "Remind them of the one outcome they wanted, then the easiest way back.",
    ],
    check: "It reads as a follow-up to someone who knows the brand, not a first introduction.",
  },
  {
    id: "launch",
    name: "Launch",
    when: { categories: ["launch"], goals: ["launch"] },
    lines: [
      "Translate what is new into what the customer can now do ('Now you can…'), in the first line.",
      "Claim only what shipped, as the brand described it; then where and when to get it, only as given.",
    ],
    check: "It names one thing the customer can do now that they couldn't before.",
  },
  {
    id: "value-proposition",
    name: "Value proposition",
    when: { categories: ["product"], goals: ["launch", "awareness"], stages: ["convince"] },
    lines: [
      "Say the one benefit the customer feels, through one concrete detail of the product (feature → which means → benefit).",
      "Frame it against what they do today (the real alternative, often doing nothing), never a named competitor.",
    ],
    check: "Swap test: another brand in the category could not post it unchanged.",
  },
  {
    id: "social-proof",
    name: "Proof",
    when: { categories: ["proof", "before-after"], stages: ["convince"] },
    lines: [
      "Use only proof the brand context really contains: a result, a quote, a number, a before/after; attribute it as given.",
      "Specific beats praise: the situation, what changed, the one result.",
      "With no proof in the context, show how it works instead; never write a testimonial.",
    ],
    check: "Every proof point is traceable to the brief or brand context.",
  },
  {
    id: "hooks",
    name: "Hook",
    when: { formats: ["video", "script", "carousel", "story"] },
    lines: [
      "The first line, first slide or first second carries the whole idea: a specific moment, a result first, a callout to one kind of person, a real choice, or a bold true claim.",
      "Visual, spoken line and on-screen words each do a different job; on mute, the words alone still hook.",
      "Never open with a greeting, the logo, 'in this video' or a generic 'stop scrolling'; pay the hook off within the next beat.",
    ],
    check: "Read alone, the hook makes the right person want the next beat.",
  },
  {
    id: "carousel-narrative",
    name: "Carousel story",
    when: { formats: ["carousel"] },
    lines: [
      "Decide the spine in one sentence first; the cover names a result or a tension (≤8 words), slide 2 pays it off and would work as a cover itself.",
      "One idea per slide in a rising order (problem → shift → steps or proof → payoff), each slide leaving a reason to swipe; a promised count is exact.",
      "End on one ask fitted to the goal: save for later, send to the person who needs it, a question to answer, or the link only if real.",
    ],
    check: "The headings alone, read in order, tell the whole story.",
  },
  {
    id: "teach",
    name: "Teach",
    when: { categories: ["tips", "myth", "list"], goals: ["education"] },
    lines: [
      "One method the reader can use today, complete enough to act on with nothing else open; steps numbered only when they are a sequence.",
      "State the point, show it with one concrete example, then tie it to the reader's own situation.",
      "Earn the save: a checklist, rule of thumb or template beats general advice.",
    ],
    check: "A reader could do it today from this piece alone.",
  },
  {
    id: "storytelling",
    name: "Story",
    when: { categories: ["storytime", "behind-scenes"], formats: ["video"] },
    lines: [
      "Drop into the moment (no backstory first); the customer or the team is the hero, the brand the guide.",
      "Stakes, one turning point, one sensory detail, one line of meaning; only events the brand context gives.",
    ],
    check: "It shows a scene instead of summarising a feeling.",
  },
  {
    id: "native-social",
    name: "Native to the feed",
    when: { categories: ["relatable", "trend", "ugc", "behind-scenes", "meme"] },
    lines: [
      "Make it look and sound like something a person in this audience would post, not an ad: their words, their places, their small details.",
      "The product appears rarely, if at all; the reader's world is the subject.",
    ],
    check: "With the brand name removed, the audience would still send it to a friend.",
  },
  {
    id: "send-trigger",
    name: "Worth sending",
    when: { goals: ["engagement", "awareness"], stages: ["attract"] },
    lines: [
      "Before writing, answer: who sends this, to whom, and why? (it describes them, it helps that person, it starts a conversation, it makes them laugh).",
      "End with an ask that fits: send it to the friend who…, save it for…, or a question that is easy to answer.",
    ],
    check: "There is a clear person who would forward it.",
  },
  {
    id: "cta-writing",
    name: "Call to action",
    when: { formats: ["ad"], goals: ["leads", "offer"] },
    lines: [
      "One action: a verb + what they get (+ a qualifier), first person where natural ('Get my free check'); never Submit, Learn more or Click here.",
      "Place it where readiness peaks: after the benefit or the proof.",
    ],
    check: "Exactly one primary action, and it says what happens next.",
  },
  {
    id: "b2b-buyer",
    name: "B2B buyer",
    when: { industries: ["b2b", "saas", "ai", "professional", "agency"] },
    lines: [
      "Speak to one role and its business pain (time, risk, audits, a boss's question); state the cost of keeping the old way.",
      "Offer a low-risk next step (a check, a pilot, a demo) and something the reader could forward to their team.",
    ],
    check: "It names a role and an outcome a manager would care about.",
  },
  {
    id: "saas-activation",
    name: "Software that gets used",
    when: { industries: ["saas", "ai"], goals: ["leads", "launch"] },
    lines: [
      "Show the first result a user gets, not a feature list; the real interface only, never an invented screen or number.",
      "If the free path is real, say it once (free trial, no card).",
    ],
    check: "A reader can picture the first five minutes of using it.",
  },
  {
    id: "local-visit",
    name: "Local visit",
    when: {
      industries: ["restaurant", "cafe", "local", "healthcare", "fitness"],
      adObjectives: ["local"],
    },
    lines: [
      "Make it unmistakably this place: the street, the dish or service, the people; hours and address only as given.",
      "The action is to come, call or book; mention the occasion or season people actually plan around.",
    ],
    check: "A local would know exactly where and when to go.",
  },
  {
    id: "ecommerce-sell",
    name: "Online shop",
    when: {
      industries: ["ecommerce", "fashion", "beauty", "grocery"],
      categories: ["sale", "product"],
    },
    lines: [
      "Show the product large and in use, true to its real look; the offer is the brand's own (bundle, threshold, gift) or none.",
      "Answer the online doubt that matters most (does it look like the photo, fit, freshness, delivery in time) with what the brand states.",
    ],
    check: "The product is unmistakable and the offer exactly as given.",
  },
  {
    id: "retention",
    name: "Bring them back",
    when: { stages: ["keep"] },
    lines: [
      "Speak to people who already bought: a better way to use it, what is new, a reason to come back or bring a friend.",
      "No guilt and no 'we miss you' pressure.",
    ],
    check: "An existing customer gets something useful from it.",
  },
  {
    id: "event-registration",
    name: "Registration",
    when: { adObjectives: ["event"], goals: ["leads"], categories: ["launch"] },
    lines: [
      "Say what they get by coming or registering, when and where (only as given), and how little it takes to sign up.",
      "Repeat the same action everywhere: one button name from first post to last.",
    ],
    check: "What, when and how to register are clear in one read.",
  },
];

function matches(when: SkillWhen, job: SkillJob): number {
  // Each matching dimension counts; a skill scoped to a dimension the job
  // doesn't match is skipped only when that is its only scope.
  let score = 0;
  let scoped = 0;
  const test = (
    list: readonly string[] | undefined,
    value: string | null | undefined,
    weight: number,
  ) => {
    if (!list) return;
    scoped++;
    if (value && list.includes(value)) score += weight;
  };
  test(when.categories, job.category, 3);
  test(when.adObjectives, job.adObjective, 3);
  test(when.goals, job.goal, 2);
  test(when.stages, job.stage, 2);
  test(when.industries, job.industry, 2);
  test(when.formats, job.format, 1);
  return scoped ? score : 0;
}

export type SkillJob = {
  category?: string | null;
  goal?: string | null;
  format?: string | null;
  adObjective?: string | null;
  industry?: IndustryId | null;
  stage?: string | null;
};

/** The skills for this piece, most specific first, at most `limit`. */
export function skillsFor(job: SkillJob, limit = 3): Skill[] {
  return SKILLS.map((skill, i) => ({ skill, score: matches(skill.when, job), i }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.skill);
}
