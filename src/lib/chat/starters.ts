// The ideas under the message box in a new chat. Pure: they are written from
// what Brand DNA already holds in the browser, so showing them costs no
// request, and they change a little every day.

export type StarterGroupId = "create" | "plan" | "found" | "competitors" | "audience";

export type StarterIdea = {
  text: string;
  /** send = ask it now · prefill = put it in the box for the person to finish */
  run: "send" | "prefill";
};

export type StarterGroup = { id: StarterGroupId; label: string; ideas: StarterIdea[] };

export type StarterFacts = {
  brand?: string;
  product?: string;
  audience?: string;
  competitor?: string;
  platform: string;
  hasWebsite: boolean;
};

/** The parts of Brand DNA the ideas are written from. */
export type StarterSource = {
  brandName?: string | null;
  products?: string | null;
  audienceTags?: readonly string[] | null;
  competitors?: readonly { name?: string | null }[] | null;
  socials?: readonly { platform?: string | null }[] | null;
  websiteUrl?: string | null;
};

export const IDEAS_PER_GROUP = 4;
const MAX_FACT = 40;

const PLATFORMS: [RegExp, string][] = [
  [/linkedin/i, "LinkedIn"],
  [/instagram/i, "Instagram"],
  [/tiktok/i, "TikTok"],
  [/facebook/i, "Facebook"],
  [/^(x|twitter)\b|twitter|x\.com/i, "X"],
];

/** One short, single-line phrase, or nothing when the value can't be one. */
function phrase(value: string | null | undefined): string | undefined {
  const first = (value ?? "")
    .split(/[\n\r,;•|]|\.\s/)[0]
    .replace(/^[\s\-–*\d.)]+/, "")
    .replace(/\s+/g, " ")
    .replace(/[.:]+$/, "")
    .trim();
  return first.length >= 2 && first.length <= MAX_FACT ? first : undefined;
}

export function starterFacts(source: StarterSource): StarterFacts {
  const social = (source.socials ?? []).map((s) => s.platform ?? "");
  const platform = PLATFORMS.find(([match]) => social.some((s) => match.test(s)))?.[1];
  return {
    brand: phrase(source.brandName),
    product: phrase(source.products),
    audience: phrase(source.audienceTags?.[0]),
    competitor: phrase(source.competitors?.[0]?.name),
    platform: platform ?? "LinkedIn",
    hasWebsite: !!source.websiteUrl?.trim(),
  };
}

const send = (text: string): StarterIdea => ({ text, run: "send" });
const prefill = (text: string): StarterIdea => ({ text, run: "prefill" });

/** Ideas that name something real come first; the rest take turns by day. */
function pick(named: (StarterIdea | null)[], general: StarterIdea[], day: number): StarterIdea[] {
  const lead = named.filter((idea): idea is StarterIdea => idea !== null);
  const offset = ((Math.trunc(day) % general.length) + general.length) % general.length;
  const turns = general.map((_, i) => general[(offset + i) % general.length]);
  return [...lead, ...turns].slice(0, IDEAS_PER_GROUP);
}

/** `day` is a whole number that changes once a day (days since 1970). */
export function buildStarters(facts: StarterFacts, day = 0): StarterGroup[] {
  const { brand, product, audience, competitor, platform, hasWebsite } = facts;
  const us = brand ?? "us";
  const we = brand ?? "we";
  const our = brand ? `${brand}'s` : "our";
  const post = `${/^[AEIOX]/.test(platform) ? "an" : "a"} ${platform} post`;

  return [
    {
      id: "create",
      label: "Create",
      ideas: pick(
        [
          product ? send(`Write ${post} about ${product}`) : null,
          audience ? send(`Write ${post} that speaks to ${audience}`) : null,
        ],
        [
          prefill(`Write ${post} about `),
          prefill("Make an Instagram image of "),
          send(`Make an Instagram carousel on why people choose ${us}`),
          send("Give me 5 post ideas for this week"),
          prefill("Write a blog article about "),
          prefill("Write a short video script about "),
        ],
        day,
      ),
    },
    {
      id: "plan",
      label: "Plan",
      ideas: pick(
        [send(`Plan next week's posts for ${us}`)],
        [
          send("What is waiting for my approval right now?"),
          send("What is planned and scheduled for the next 7 days?"),
          send("Build a 30-day marketing plan with the biggest wins first"),
          send("What should I post today?"),
          prefill("Plan a launch for "),
        ],
        day,
      ),
    },
    {
      id: "found",
      label: "Get found",
      ideas: pick(
        [
          hasWebsite
            ? send(
                `How well does ${brand ?? "my brand"} show up in AI search, and what should I fix first?`,
              )
            : send("What do I need to set up so you can check my website?"),
        ],
        [
          send("What are the top fixes for my website right now?"),
          send(`Which questions should ${we} show up for in AI answers?`),
          send("How did our content and website do over the last 30 days?"),
          prefill("Write an article that answers this question: "),
        ],
        day,
      ),
    },
    {
      id: "competitors",
      label: "Competitors",
      ideas: pick(
        competitor
          ? [
              send(`What has ${competitor} done lately?`),
              send(`Where can ${we} beat ${competitor}?`),
            ]
          : [send("Who are my main competitors?")],
        [
          send("What have our tracked competitors done recently?"),
          send("What are our competitors posting that works?"),
          send("What's new in our market this week?"),
          send("Where can we win against our competitors?"),
        ],
        day,
      ),
    },
    {
      id: "audience",
      label: "Audience",
      ideas: pick(
        [audience ? send(`What does ${audience} want to hear from ${us}?`) : null],
        [
          send(`Who is ${our} best customer, and what do they care about?`),
          send("What do our customers ask before they buy?"),
          send("Which of our posts worked best, and why?"),
          prefill("How would our audience react to this: "),
        ],
        day,
      ),
    },
  ];
}
