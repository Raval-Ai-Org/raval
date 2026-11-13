// Industry playbooks: why a restaurant post must not look like a SaaS ad.
//
// Each playbook says how the brand's category is photographed or drawn, how
// it is lit and typeset, what its buyers want and doubt, what proof they
// believe, which campaign layouts (art-direction.ts) suit it first and how
// much humour it carries. Distilled from the Round 5 research
// (docs/studio/marketing-knowledge.md) and the reference study; brand-neutral.
// Pure and browser-safe. Ids may be stored later: add, never rename.
import type { ArchetypeId } from "../art-direction";

export type IndustryId =
  | "saas"
  | "ai"
  | "ecommerce"
  | "fashion"
  | "beauty"
  | "restaurant"
  | "cafe"
  | "real-estate"
  | "education"
  | "fitness"
  | "healthcare"
  | "finance"
  | "professional"
  | "automotive"
  | "travel"
  | "hospitality"
  | "agency"
  | "local"
  | "b2b"
  | "grocery";

export type Industry = {
  id: IndustryId;
  label: string;
  /** Matched against the brand's industry line first, then its description. */
  match: RegExp;
  /** How the picture is made: medium, light, palette energy, type, composition. */
  look: string;
  /** What this category's pictures must never do. */
  avoid: string;
  /** What makes its buyers act. */
  wants: string;
  /** What holds them back (answer one, never all). */
  doubts: string;
  /** The proof they believe. */
  proof: string;
  /** Campaign layouts to consider first, in order. */
  layouts: readonly ArchetypeId[];
  /** How much humour the category carries: memes land, sometimes, or rarely. */
  humour: "high" | "some" | "low";
};

export const INDUSTRIES: readonly Industry[] = [
  {
    id: "ai",
    label: "AI products",
    match: /\b(ai|a\.i\.|artificial intelligence|machine learning|llm|agent(s|ic)?|gpt)\b/i,
    look: "Concrete use, never sci-fi: the input becoming the output, a real person getting work done, or type-led. Neutral daylight, restrained palette with one accent, a geometric or humanist sans, split or before/after composition.",
    avoid:
      "glowing brains, robots, robot hands, neural-net particles, circuit boards, purple-blue gradients, floating holograms",
    wants: "time back, better output than they could make alone, control over the result",
    doubts: "output is generic; data security; one more tool to learn",
    proof:
      "a real before/after of the work, a named workflow it removes, a short demo of the actual interface",
    layouts: [
      "device-showcase",
      "clean-split",
      "literal-metaphor",
      "annotated-giant",
      "benefit-list",
    ],
    humour: "some",
  },
  {
    id: "finance",
    label: "Finance and fintech",
    match:
      /\b(financ(e|ial)|fintech|bank(ing)?|savings?|loan|invest(ing|ment)?|insurance|wallet|payments?|budget)\b/i,
    look: "Type-led or a simple, honest data picture and real people with their everyday money moments; neutral light; a deep, trustworthy base with one accent; serif or sturdy sans with tabular numbers.",
    avoid:
      "money piles, rocket arrows, guaranteed-return language, invented interest rates, gold coins raining",
    wants:
      "control and calm about money, a habit that sticks, trust that it is safe (and halal where that matters)",
    doubts: "is it safe; hidden fees; is it permitted for me",
    proof: "how it works in plain steps, the security and compliance facts the brand states",
    layouts: ["number-monument", "clean-split", "literal-metaphor", "benefit-list"],
    humour: "some",
  },
  {
    id: "saas",
    label: "Software (SaaS)",
    match:
      /\b(saas|software|app\b|platform|cloud|crm|accounting software|tool for teams|b2b software)\b/i,
    look: "The real product interface in a device or a clean crop of it, or a simple diagram of the outcome. Flat, even light; one confident brand colour on neutrals; a modern grotesk with tabular figures; one outcome headline beside a UI crop.",
    avoid:
      "fake dashboards with invented numbers, gradient blobs, glassmorphism cards, stock people high-fiving at laptops, rockets for growth",
    wants:
      "the painful task done faster, fewer mistakes, looking competent to their boss or clients",
    doubts: "switching cost; price per seat; another login",
    proof:
      "time saved on one named task, the actual screen, a customer's own words (only if given)",
    layouts: [
      "device-showcase",
      "clean-split",
      "number-monument",
      "touchpoint-world",
      "benefit-list",
    ],
    humour: "high",
  },
  {
    id: "fashion",
    label: "Fashion",
    match: /\b(fashion|apparel|clothing|wear|lawn|chiffon|kurta|couture|garment|outfit)\b/i,
    look: "Editorial photography: the garment on a fictional model in a real place, directional hard light or golden hour, muted palette with one signature tone, high-contrast serif or condensed display, asymmetric crops with generous space.",
    avoid:
      "flat catalogue shots, stiff stock smiles, plastic skin, fabric that looks rendered, clutter around the garment",
    wants:
      "to look and feel their best for a moment that matters (an occasion, a season), to be complimented",
    doubts: "fabric and colour differ from the photo; sizing; delivery in time for the occasion",
    proof:
      "close-up of fabric and finish, the piece worn and moving, delivery promise exactly as stated",
    layouts: [
      "quiet-editorial",
      "portrait-backdrop",
      "occasion-symbol",
      "film-strip-cutout",
      "hero-world",
    ],
    humour: "some",
  },
  {
    id: "beauty",
    label: "Beauty and skincare",
    match: /\b(beauty|skin ?care|cosmetic|serum|makeup|haircare|salon|spa|fragrance)\b/i,
    look: "Macro texture (a swatch, a droplet, real skin with pores) and the product centred with its ingredient world; soft, diffused, luminous light; nude or pastel tones with one deep accent; refined serif or light sans.",
    avoid:
      "plastic airbrushed skin, unprovable claims, before/after without real proof, floating bottles, sparkles",
    wants: "visible, gentle results; feeling confident in their own skin; a routine that is simple",
    doubts: "will it irritate me; is it worth the price; does it really work",
    proof: "the texture itself, ingredient facts the brand states, tested-on claims only as given",
    layouts: ["glossy-macro", "hero-world", "material-swap", "quiet-editorial", "exploded-view"],
    humour: "some",
  },
  {
    id: "restaurant",
    label: "Restaurants and food",
    match:
      /\b(restaurant|bbq|grill|kebab|food|kitchen|eatery|dine|dining|biryani|pizza|burger|bakery|catering|iftar)\b/i,
    look: "Appetite first: the hero dish in a tight 45-degree or overhead crop, hands, steam, char and sauce; warm window or ember light (never a blue cast); warm appetising tones; a characterful display face with a plain body.",
    avoid:
      "stock plating, over-saturated colour, cold light, cutlery-only flat lays, tiny food in a big empty frame",
    wants: "a meal worth the trip, sharing with family and friends, a taste they remember",
    doubts: "wait times, parking, hygiene, value for the group size",
    proof:
      "the dish up close and real, the price and portion exactly as given, the crowd and the place itself",
    layouts: ["glossy-macro", "flat-lay-story", "hero-world", "occasion-symbol", "monument-object"],
    humour: "high",
  },
  {
    id: "cafe",
    label: "Cafés and coffee",
    match: /\b(caf[eé]|coffee|espresso|tea|chai|latte|roast(er|ery)|bakery)\b/i,
    look: "Cosy and real: the cup in hand or on a worn table, latte art, pastry crumbs, morning window light, warm neutrals with the brand accent, a friendly serif or hand-made accent.",
    avoid: "sterile studio cups, steam added as a cartoon, stock baristas, glossy CGI drinks",
    wants: "a small daily ritual, a place to sit and work or meet, a drink that tastes like care",
    doubts: "price compared with a chain; seats and Wi-Fi; is it worth the walk",
    proof: "the drink itself, the space, a loyalty or pass offer exactly as given",
    layouts: ["flat-lay-story", "glossy-macro", "quiet-editorial", "occasion-symbol"],
    humour: "high",
  },
  {
    id: "real-estate",
    label: "Real estate",
    match:
      /\b(real estate|realty|property|properties|homes?\b|housing|apartment|listing|realtor|estate agent)\b/i,
    look: "Architectural wide shots with straight verticals plus lifestyle details (keys, a lit window, a family moment); twilight or bright daylight; calm neutrals with a deep accent; a classic serif or clean sans with a facts strip.",
    avoid:
      "fisheye distortion, fake staging, invented prices or sizes, stock handshakes, house icons",
    wants:
      "a safe, right home for their stage of life, an agent who is on their side, no surprises",
    doubts: "hidden fees, pushy agents, not knowing the area, affordability",
    proof: "real listings and facts as given, the local agent's face, plain answers to costs",
    layouts: ["quiet-editorial", "hero-world", "clean-split", "callout-board"],
    humour: "some",
  },
  {
    id: "education",
    label: "Education and tutoring",
    match:
      /\b(education|tutor(ing)?|academy|school|course|class(es)?|learning|o-level|a-level|coaching|training institute)\b/i,
    look: "Real learning moments (a student's notebook, a teacher explaining, a progress report) or clean diagrams and steps; bright even light; friendly ordered palette; a rounded humanist sans; step or list structure.",
    avoid: "clip-art caps and gowns, walls of text, stock classrooms, invented grades or results",
    wants:
      "for parents: visible progress and peace of mind; for students: passing with less stress",
    doubts: "online classes don't work; teacher quality; cost vs results",
    proof:
      "how progress is shown (reports, small batches), a real parent's words only if given, a free trial if offered",
    layouts: ["benefit-list", "callout-board", "clean-split", "literal-metaphor"],
    humour: "high",
  },
  {
    id: "fitness",
    label: "Fitness and gyms",
    match: /\b(fitness|gym|workout|training|yoga|pilates|crossfit|strength|coach(ing)? for)\b/i,
    look: "Action photography mid-movement with real bodies, hard contrasty light, dark base with one vivid accent, condensed bold caps, diagonal dynamic lines.",
    avoid:
      "unrealistic bodies, shaming copy, before/after without real people, stock dumbbells on white",
    wants: "to feel strong and capable, to not be judged, a plan they can keep",
    doubts: "gym anxiety; not fit enough to start; quitting after two weeks; membership cost",
    proof:
      "real members and coaches in action, the structure of the programme, a free first session if offered",
    layouts: ["peak-action", "portrait-backdrop", "number-monument", "clean-split"],
    humour: "high",
  },
  {
    id: "healthcare",
    label: "Healthcare",
    match:
      /\b(health(care)?|clinic|doctor|medical|hospital|dental|dentist|pharmacy|physio|therapy|gp\b)\b/i,
    look: "Real clinicians and calm settings, soft natural light, clean blues, greens and whites with warmth, a highly legible sans, generous space and clear facts.",
    avoid:
      "fear imagery, unprovable outcomes, stock stethoscopes, needles close-up, red alarm colours",
    wants: "to be seen quickly and taken seriously, reassurance for their family",
    doubts: "waiting times; cost and insurance; being rushed",
    proof:
      "how booking and waiting work, the real team, opening hours and services exactly as stated",
    layouts: ["quiet-editorial", "benefit-list", "callout-board", "clean-split"],
    humour: "low",
  },
  {
    id: "professional",
    label: "Professional services",
    match:
      /\b(law|legal|lawyer|attorney|accountant|accounting firm|consult(ing|ancy)|advisory|tax|notary)\b/i,
    look: "Portraits of the real team and the working detail (a marked-up contract, a calm meeting), soft studio or office daylight, sober palette with one accent, serif headline with sans body, insight- or quote-led layout.",
    avoid: "handshakes, chess pieces, gavels, scales of justice clip-art, stock suits",
    wants: "certainty and a fixed, fair cost; to avoid an expensive mistake",
    doubts: "it will be expensive; a template is enough; they won't understand me",
    proof: "a fixed fee as stated, the process step by step, the person who will do the work",
    layouts: ["quiet-editorial", "callout-board", "portrait-backdrop", "clean-split"],
    humour: "some",
  },
  {
    id: "automotive",
    label: "Automotive",
    match: /\b(auto(motive)?|car(s)?\b|vehicle|detailing|garage|motor|tyre|tire|dealership)\b/i,
    look: "Dramatic vehicle photography or detail macro (paint reflections, water beading), low angles with rim or dusk light, dark base with metallic or brand colour, wide extended sans, strong diagonals.",
    avoid: "floating cars, warped wheels, invented specs, cartoon shine stars",
    wants: "pride in the car, a finish that lasts, trust the work is done right",
    doubts: "price; does it really last; will they damage my car",
    proof: "real before/after on the brand's own work, the process and materials as stated",
    layouts: ["glossy-macro", "spotlight-noir", "clean-split", "monument-object"],
    humour: "some",
  },
  {
    id: "travel",
    label: "Travel and tours",
    match: /\b(travel|tour(s|ism)?|trip|trek|holiday|vacation|destination|honeymoon|adventure)\b/i,
    look: "Immersive landscape with a person for scale, golden-hour light, destination-true colour, elegant serif or airy sans, wide frames with text in the sky or open space.",
    avoid:
      "over-HDR, composite skies, stock beaches for a mountain trip, invented itineraries or prices",
    wants: "a trip they will talk about for years, safety and no planning stress, good company",
    doubts: "safety and roads, hotel quality, weather, price",
    proof: "the real itinerary and inclusions, local guides, what is included exactly as given",
    layouts: ["hero-world", "double-exposure", "occasion-symbol", "film-strip-cutout"],
    humour: "some",
  },
  {
    id: "hospitality",
    label: "Hotels and hospitality",
    match: /\b(hotel|resort|guest ?house|b&b|inn|lodge|boutique stay|suite)\b/i,
    look: "Interiors and service moments with real materials, warm ambient or practical light, soft rich textures, a refined serif, calm centred vignettes.",
    avoid: "empty sterile rooms, wide-angle stretch, stock spa stones, invented rates",
    wants: "rest and a feeling of being looked after, a place that feels like theirs",
    doubts: "price per night; location; is it like the photos",
    proof: "the real rooms and details, the package exactly as stated",
    layouts: ["quiet-editorial", "hero-world", "flat-lay-story", "occasion-symbol"],
    humour: "low",
  },
  {
    id: "agency",
    label: "Marketing agencies",
    match:
      /\b(agency|marketing (services|firm)|creative studio|paid social|performance marketing|media buying)\b/i,
    look: "Bold typography as the image, crops of real work and results, studio light, daring but systematic, expressive display type, grid-breaking yet deliberate.",
    avoid: "buzzword collages, generic AI looks, rocket ships, megaphones, invented ROAS figures",
    wants: "growth they can see in the bank, a partner who tells the truth",
    doubts: "retainer cost; long contracts; agencies that report vanity metrics",
    proof: "their method, real results only as given, a free audit if offered",
    layouts: ["name-on-the-wall", "material-lettering", "callout-board", "number-monument"],
    humour: "high",
  },
  {
    id: "b2b",
    label: "B2B services",
    match:
      /\b(b2b|cyber ?security|it services|managed services|logistics|enterprise|compliance|security operations)\b/i,
    look: "Process made visible (a simple diagram, a real deliverable, the team at work), even light, navy or graphite with one confident colour, a sturdy sans, problem → method → result.",
    avoid:
      "abstract networks, puzzle pieces, globes, padlocks with glow, hooded hackers, fear-mongering",
    wants:
      "risk off their desk, fewer alerts and audits to worry about, looking good to leadership",
    doubts: "cost; we already have something; disruption to switch",
    proof: "the method in steps, what is monitored or delivered, a free check if offered",
    layouts: ["clean-split", "annotated-giant", "literal-metaphor", "benefit-list"],
    humour: "some",
  },
  {
    id: "grocery",
    label: "Grocery and fresh produce",
    match: /\b(grocer(y|ies)|organic|produce|farm|veg(etable)?s?|fruit box|meal kit)\b/i,
    look: "Fresh produce with soil and dew, in a box or on a kitchen table, natural daylight, leafy greens and kraft tones, a homely serif or clean sans.",
    avoid: "plastic-looking fruit, supermarket stock shots, invented health claims",
    wants: "fresh food they trust for their family, less time in the shop",
    doubts: "organic costs more; delivery slots; freshness on arrival",
    proof:
      "what is in the box this week, where it comes from as stated, the offer exactly as given",
    layouts: ["flat-lay-story", "hero-world", "glossy-macro", "exploded-view"],
    humour: "some",
  },
  {
    id: "ecommerce",
    label: "Online shops",
    match:
      /\b(e-?commerce|online (shop|store)|shop\b|store\b|delivery|bouquet|flowers?|gifts?|dtc|d2c)\b/i,
    look: "The product photographed large on a coloured set or in use, soft key light with a crisp shadow, a bold seasonal accent, a heavy sans headline with a clear price or offer block.",
    avoid:
      "clutter, fake badges and ribbons, invented discounts, tiny products, floating packshots",
    wants: "the right thing, delivered on time, looking like the photo",
    doubts: "quality vs photo; delivery time; returns",
    proof: "real product photos, delivery promise and offer exactly as stated",
    layouts: ["hero-world", "monument-object", "exploded-view", "occasion-symbol", "benefit-list"],
    humour: "some",
  },
  {
    id: "local",
    label: "Local businesses",
    match: /\b(local|neighbou?rhood|shop on|stall|corner|family[- ]run|since \d{4})\b/i,
    look: "The real owner, storefront and street, natural daylight, the brand's actual colours, a clear sans with an optional hand-made accent, the person or place as the hero with address or hours.",
    avoid: "stock cities, fake crowds, generic skylines",
    wants: "something good nearby made by people they know",
    doubts: "is it worth the trip; opening hours; hygiene",
    proof: "the place and people themselves, hours and address as stated",
    layouts: ["brand-miniature-store", "portrait-backdrop", "quiet-editorial", "occasion-symbol"],
    humour: "high",
  },
];

/** The brand's industry playbook, from its industry line, then its whole description. */
export function industryOf(industry?: string | null, text?: string | null): Industry | null {
  const line = (industry ?? "").trim();
  if (line) {
    const hit = INDUSTRIES.find((i) => i.match.test(line));
    if (hit) return hit;
  }
  const body = (text ?? "").slice(0, 3000);
  if (!body) return null;
  // The description names many things: take the playbook with most matches.
  let best: Industry | null = null;
  let most = 0;
  for (const item of INDUSTRIES) {
    const flags = item.match.flags.includes("g") ? item.match.flags : `${item.match.flags}g`;
    const n = body.match(new RegExp(item.match.source, flags))?.length ?? 0;
    if (n > most) {
      most = n;
      best = item;
    }
  }
  return most >= 2 ? best : null;
}

/** The picture lines for a visual brief: how this category looks and what it avoids. */
export function industryPictureLines(item: Industry | null): string[] {
  if (!item) return [];
  return [`Category look (${item.label}): ${item.look}`, `Never for this category: ${item.avoid}.`];
}

/** The buyer lines for a writer: what they want, doubt and believe. */
export function industryBuyerLines(item: Industry | null): string[] {
  if (!item) return [];
  return [
    `Buyers in ${item.label.toLowerCase()} want ${item.wants}. They hesitate over ${item.doubts}; answer at most one doubt per piece. They believe ${item.proof}, and only what the brand context really states.`,
  ];
}
