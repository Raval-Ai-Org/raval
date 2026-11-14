// Studio categories: the kinds of post that travel on Instagram, written down
// once. A person picks one in Studio (or Write it for me picks one for them);
// every writer, the visual brief and the image prompt then follow it, so a
// meme reads and looks like a meme and a sale post like a designed sale post.
//
// A category is the genre of a piece. It sits beside the aim (viral.ts: why a
// stranger keeps, sends or answers it) and the template (templates.ts: the
// exact structure). Each one says:
//   - why it spreads, and the aim it serves by default;
//   - how to write it, and what never to do;
//   - how the picture looks: `register` "native" (made on a phone, posted by a
//     person) or "designed" (a professional, art-directed post), plus the
//     picture's own rules and, for memes, the meme layouts;
//   - how a carousel and a video of it are built.
//
// Ids are stored on jobs (intent.category): add categories, never rename ids.
// Pure and browser-safe.
import type { GoalId } from "./jobs";
import type { StudioType } from "./formats";
import type { ShareAimId } from "./viral";

export const CATEGORY_IDS = [
  "sale",
  "product",
  "launch",
  "meme",
  "relatable",
  "trend",
  "tips",
  "myth",
  "before-after",
  "proof",
  "behind-scenes",
  "storytime",
  "this-or-that",
  "quote",
  "local",
  "aesthetic",
  "list",
  "ugc",
] as const;

export type CategoryId = (typeof CATEGORY_IDS)[number];

/** How the picture is made: posted by a person, or designed by a studio. */
export type Register = "native" | "designed";

/** Groups in the picker, in this order. */
export type CategoryGroup = "sell" | "fun" | "teach" | "trust";

export const CATEGORY_GROUPS: readonly { id: CategoryGroup; label: string }[] = [
  { id: "sell", label: "Sell" },
  { id: "fun", label: "Fun & viral" },
  { id: "teach", label: "Teach" },
  { id: "trust", label: "Trust & people" },
];

export type Category = {
  id: CategoryId;
  group: CategoryGroup;
  /** What people read in the picker: plain everyday words. */
  label: string;
  tagline: string;
  /** One emoji-free glyph key for the tile (see CategoryPicker). */
  glyph:
    | "tag"
    | "box"
    | "rocket"
    | "laugh"
    | "eye"
    | "flame"
    | "bulb"
    | "scale"
    | "split"
    | "star"
    | "camera"
    | "book"
    | "vote"
    | "quote"
    | "pin"
    | "leaf"
    | "list"
    | "phone";
  /** Why this kind of post gets passed on (shown as a hint, sent to the writer). */
  whyItSpreads: string;
  aim: ShareAimId;
  goal: GoalId;
  /** Formats it suits, best first. */
  formats: readonly StudioType[];
  register: Register;
  /** How to write it. */
  write: readonly string[];
  /** How the picture looks. */
  picture: readonly string[];
  /** How a carousel of it is built (slide by slide). */
  carousel: string;
  /** How a video or Reel of it is built. */
  video: string;
  /** The carousel structure it maps to (carousel/story.ts), when one fits. */
  carouselStructure?: string;
};

/* ───────────────────────────── rules every category shares ───────────────────────────── */

/** Local without inventing: the culture of the people the brand serves. */
export const LOCAL_RULE =
  "Make it feel local to the people this brand serves: the places, food, weather, habits, slang and everyday moments of their city or country, as the brand context and the content language show them. Use only what everyone there would recognise; never invent a local event, news story, date, person or statistic. If the place is unknown, keep it universal.";

/** What separates a professional post from a generic AI one. */
export const NOT_GENERIC_RULES: readonly string[] = [
  "Build it on this brand's own product, audience and situation; a post another brand could post unchanged is wrong.",
  "One idea, one focal point, one emotion. Cut everything else.",
  "Specific beats clever: a named moment, a real object, a real feeling.",
  "No AI tells: no glossy plastic skin, no floating products, no random sparkles or bokeh orbs, no gibberish text, no purple-pink gradients, no 'futuristic' blue glow.",
];

const NATIVE_PICTURE: readonly string[] = [
  "Look: shot on a phone by a real person, natural or mixed indoor light, real places and real mess, slight imperfection; never a studio poster, never 3D-rendered, never airbrushed.",
  "Words on the picture, when there are any, are set like Instagram's own text: bold white sans with a thin black outline, or black on a white bar; large, plain, never decorative.",
];

const DESIGNED_PICTURE: readonly string[] = [
  "Look: a professional, art-directed post a top agency would ship for this brand: one strong layout, the brand's colours and type, clean hierarchy, generous space.",
];

/* ───────────────────────────── meme layouts ───────────────────────────── */

export type MemeLayoutId =
  | "top-bottom"
  | "pov"
  | "expectation-reality"
  | "two-panel-reaction"
  | "nobody-me"
  | "text-thread"
  | "tweet"
  | "me-also-me";

export type MemeLayout = {
  id: MemeLayoutId;
  name: string;
  /** How the picture is laid out (for the image model). */
  layout: string;
  /** The lines it needs, in order, as labels for the exact text. */
  lines: readonly string[];
};

/**
 * Meme structures, never famous templates: a famous meme is a photo of a real
 * person, so the picture is always an original scene with a fictional person.
 */
export const MEME_LAYOUTS: readonly MemeLayout[] = [
  {
    id: "top-bottom",
    name: "Top and bottom caption",
    layout:
      "One reaction photo filling the frame; the setup line across the top and the punchline across the bottom, in bold white uppercase with a black outline.",
    lines: ["Top", "Bottom"],
  },
  {
    id: "pov",
    name: "POV",
    layout:
      "One first-person or over-the-shoulder phone photo of the moment; a white bar at the top holding one line that starts with 'POV:', black text, left aligned.",
    lines: ["POV line"],
  },
  {
    id: "expectation-reality",
    name: "Expectation vs reality",
    layout:
      "Two photos stacked (or side by side): a polished 'expectation' and a real, funnier 'reality', each with a small black label bar; the brand's product makes the reality better, not worse.",
    lines: ["Expectation label", "Reality label"],
  },
  {
    id: "two-panel-reaction",
    name: "Two-panel reaction",
    layout:
      "Two stacked panels of the same fictional person: panel one turning away from the old way, panel two delighted by the new way; one short line beside each panel on a white column.",
    lines: ["Panel one", "Panel two"],
  },
  {
    id: "nobody-me",
    name: "Nobody: / Me:",
    layout:
      "A white text block at the top with two left-aligned lines ('Nobody:' then 'Me: …'), and under it one candid photo of the person doing the oddly specific thing.",
    lines: ["Nobody line", "Me line"],
  },
  {
    id: "text-thread",
    name: "Text messages",
    layout:
      "A phone chat screen drawn flat and straight on: three to five message bubbles in a plausible messaging look (no app's logo or name), the last bubble is the punchline.",
    lines: ["Message 1", "Message 2", "Message 3"],
  },
  {
    id: "tweet",
    name: "Post screenshot",
    layout:
      "A clean text-post card on white (round avatar of a fictional person, a made-up display name, one short post), no real platform's logo, no likes or numbers.",
    lines: ["Post"],
  },
  {
    id: "me-also-me",
    name: "Me vs also me",
    layout:
      "Split frame: the same fictional person in two moods or moments, a short label over each half on a black bar.",
    lines: ["Left label", "Right label"],
  },
];

export function memeLayout(id: unknown): MemeLayout | null {
  return MEME_LAYOUTS.find((m) => m.id === id) ?? null;
}

/* ───────────────────────────── the categories ───────────────────────────── */

export const CATEGORIES: readonly Category[] = [
  /* Sell */
  {
    id: "sale",
    group: "sell",
    label: "Sale & offer",
    tagline: "A deal people get at a glance",
    glyph: "tag",
    whyItSpreads: "People send a good deal to the friend who wanted that thing.",
    aim: "act",
    goal: "offer",
    formats: ["image", "carousel", "story", "video", "ad"],
    register: "designed",
    write: [
      "Lead with the offer in the person's own words (the exact discount, price or deal they gave), then who it is for, then the deadline if they gave one, then one action.",
      "The offer is the headline: big, short, unmissable (for example the number and the word OFF). Never invent a figure, a code or an end date.",
      "Give one reason to buy now that is true: the season, the occasion, the product's best use.",
    ],
    picture: [
      "A designed sale poster: the offer as the dominant type (the figure huge, the rest small), the product itself shown large and real, the brand colours with one hot accent on the offer.",
      "Reading order: offer → product → brand. Leave clean space for the type; no clutter, no price tags or ribbons the brief didn't ask for.",
    ],
    carousel:
      "Slide 1 the offer, huge. Then one slide per product or per reason to buy, each with one line. Last slide: how to get it and the deadline, only if given.",
    video:
      "Open on the offer as words on screen in the first second, then the product in use, then the deadline and the action. Fast cuts, on-beat.",
  },
  {
    id: "product",
    group: "sell",
    label: "Product showcase",
    tagline: "Your product, looking its best",
    glyph: "box",
    whyItSpreads: "A product shown in a scene people want to be in gets saved and sent.",
    aim: "save",
    goal: "launch",
    formats: ["image", "carousel", "video", "story"],
    register: "designed",
    write: [
      "Sell one benefit the customer feels, through one sensory or practical detail. Name the product exactly as the brand does.",
    ],
    picture: [
      "The product is the hero, true to its real shape and label, staged in a world that says its benefit (a set, a moment, a scale surprise), lit like a campaign shoot.",
    ],
    carousel:
      "Slide 1 the product hero shot with one line. Then a detail, a use, a benefit per slide. Last slide where to get it.",
    video:
      "A reveal: tight detail, the product in hand or in use, the hero frame, the name. One camera move per shot.",
    carouselStructure: "soft-sell",
  },
  {
    id: "launch",
    group: "sell",
    label: "New launch",
    tagline: "Something new is here",
    glyph: "rocket",
    whyItSpreads: "New things get shared by the people who were waiting for them.",
    aim: "send",
    goal: "launch",
    formats: ["image", "carousel", "video", "story"],
    register: "designed",
    write: [
      "Say what is new in the first line, then the one thing it changes for the customer, then where to get it. Excited, never hyped.",
    ],
    picture: [
      "A launch key visual: the new thing revealed dramatically (light falling on it, an unwrapping, a spotlight), the word NEW or the name set big.",
    ],
    carousel:
      "Slide 1 the reveal. Then what it is, what it does, who it is for. Last slide: available where and when (only as given).",
    video:
      "Tease → reveal → it in use → name and where to get it. The reveal lands before second 3.",
  },

  /* Fun & viral */
  {
    id: "meme",
    group: "fun",
    label: "Meme",
    tagline: "A joke your customers will send",
    glyph: "laugh",
    whyItSpreads: "Memes are sent to friends: 'this is so us'. Sends are what grow an account.",
    aim: "send",
    goal: "engagement",
    formats: ["image", "carousel", "video", "story", "social"],
    register: "native",
    write: [
      "One joke about a small, true pain or habit of the brand's customers. The product is the punchline or the fix, never a sales pitch.",
      "Use a meme structure (see the layouts). At most 12 words on the picture in total. Write it like a person, lowercase is fine, no brand voice polish, no hashtags on the picture.",
      "Punch up or at the situation, never at a person, a group or a competitor. No real people, no famous meme photos, no copyrighted characters.",
      "The caption plays along with the joke in one or two lines and asks people to tag the friend who does this. Never explain the joke.",
    ],
    picture: [
      "An original meme: a candid, slightly imperfect phone photo of a fictional person (or a funny object scene) that carries the reaction, laid out in the chosen meme layout.",
      "The text is the classic meme text, large and plain. The product appears naturally in the scene, never as an ad shot.",
    ],
    carousel:
      "A meme dump: 4 to 7 slides, each its own meme on one theme the audience lives, the last one lands on the product. Each slide stands alone.",
    video:
      "A meme Reel: text-on-screen setup in the first frame ('when you…'), the reaction shot, the twist. Under 10 seconds, loops cleanly.",
    carouselStructure: "running-joke",
  },
  {
    id: "relatable",
    group: "fun",
    label: "Relatable POV",
    tagline: '"That\'s so me" moments',
    glyph: "eye",
    whyItSpreads: "People comment 'literally me' and tag the friend it describes.",
    aim: "relate",
    goal: "engagement",
    formats: ["image", "carousel", "video", "story", "social"],
    register: "native",
    write: [
      "Describe one tiny, exact moment from the customer's day as they would say it ('POV: …', 'when you…', 'me at 2am…'). The product shows up as part of the moment, not as an ad.",
      "Short, first person, conversational. End the caption with a question they can answer in a word.",
    ],
    picture: [
      "A candid first-person or over-the-shoulder phone photo of exactly that moment, in the customer's real setting; one short line on the picture at most.",
    ],
    carousel:
      "'Signs you're a…' or 'things only … understand': one moment per slide, a photo and one line each, the last slide the brand's version.",
    video:
      "A POV Reel: the camera is the viewer, text on screen says the situation, the moment plays out in 2–3 quick shots.",
  },
  {
    id: "trend",
    group: "fun",
    label: "Trend remix",
    tagline: "Ride what's popular right now",
    glyph: "flame",
    whyItSpreads: "A format people already know gets watched to the end and remixed.",
    aim: "send",
    goal: "awareness",
    formats: ["video", "image", "carousel", "story"],
    register: "native",
    write: [
      "Take one format from 'What is working right now' and remake it for this brand's world. Say it in the format's own words and rhythm, never 'we jumped on the trend'.",
      "If no current format is supplied, use a long-running Instagram format (this or that, rating things, 'things I'd never do as a …') instead of inventing a trend.",
    ],
    picture: [
      "Made the way that format is made on Instagram right now: phone-native, the format's own layout and text style, the brand's product in place of the usual subject.",
    ],
    carousel:
      "Follow the trend's own slide pattern; one beat per slide, the brand twist on the last slide.",
    video:
      "Follow the trend's beats and timing; the brand twist lands in the last third. Text on screen names the format's setup.",
  },

  /* Teach */
  {
    id: "tips",
    group: "teach",
    label: "Tips & how-to",
    tagline: "Useful enough to save",
    glyph: "bulb",
    whyItSpreads: "Saves: people keep a post they will use later, and saves push reach.",
    aim: "save",
    goal: "education",
    formats: ["carousel", "image", "video", "story", "social"],
    register: "designed",
    write: [
      "A promise in the first line ('3 ways to…', 'stop doing X'), then each tip as one concrete action with the why in a few words. Complete enough to use with nothing else open.",
      "Ask people to save it.",
    ],
    picture: [
      "A designed tip card: a strong cover line, a clear visual of the tip (the object, the hand doing it), clean grid and lots of space.",
    ],
    carousel:
      "Cover with the promise and the number. One tip per slide: a big number, a short headline, one line. Last slide: a summary and 'save this'.",
    video:
      "Hook with the promise in frame one, then each tip as a fast shot with its words on screen, end on the best one.",
    carouselStructure: "steps",
  },
  {
    id: "myth",
    group: "teach",
    label: "Myth vs fact",
    tagline: "Clear up what people get wrong",
    glyph: "scale",
    whyItSpreads: "People share a correction and argue in the comments.",
    aim: "reply",
    goal: "education",
    formats: ["carousel", "image", "video", "social"],
    register: "designed",
    write: [
      "State a belief the audience really holds, then what is true, using only facts from the brand context. Calm and sure, never smug.",
    ],
    picture: [
      "A designed split card: MYTH struck through on one side, FACT on the other, with a visual for each.",
    ],
    carousel:
      "Cover: 'Myths about …'. Each myth slide then its fact slide (or both on one), last slide the brand's take.",
    video: "The myth as text on screen, a beat, then the truth shown. One myth per Reel.",
    carouselStructure: "myths",
  },
  {
    id: "before-after",
    group: "teach",
    label: "Before & after",
    tagline: "Show the change",
    glyph: "split",
    whyItSpreads: "A visible change stops the scroll and gets sent as proof.",
    aim: "send",
    goal: "leads",
    formats: ["image", "carousel", "video", "story"],
    register: "designed",
    write: [
      "Name the before in the customer's words, show what changed, and the after. Only a real result from the brief or the brand; never an invented figure.",
    ],
    picture: [
      "A clean split: before on the left (flat, dull light), after on the right (alive, the brand's light), small BEFORE / AFTER labels; the same angle and framing on both sides.",
    ],
    carousel:
      "Slide 1 the after with a hook. Slide 2 the before. Then the steps between. Last slide how to get the same.",
    video:
      "The before, a hard cut or swipe on the beat, the after. The change happens in the first 3 seconds.",
    carouselStructure: "comparison",
  },
  {
    id: "list",
    group: "teach",
    label: "Top picks list",
    tagline: '"5 things" people bookmark',
    glyph: "list",
    whyItSpreads: "Lists get saved and finished: people swipe to see number one.",
    aim: "save",
    goal: "awareness",
    formats: ["carousel", "video", "image"],
    register: "designed",
    write: [
      "A numbered list with a reason to see the end (counting down to the best). Each item one line and one reason.",
    ],
    picture: ["A designed cover: the number big, the topic plain, one item shown."],
    carousel:
      "Cover with the number. One item per slide counting down, the best (or the brand's own) last.",
    video: "Rapid countdown, each item a shot with its number, the best last.",
    carouselStructure: "list",
  },

  /* Trust & people */
  {
    id: "proof",
    group: "trust",
    label: "Reviews & results",
    tagline: "Let customers do the talking",
    glyph: "star",
    whyItSpreads: "Real words from customers convince the next customer.",
    aim: "act",
    goal: "leads",
    formats: ["image", "carousel", "video", "story"],
    register: "designed",
    write: [
      "Use only a review, result or figure the person or the brand context gave, word for word. If none is given, write about what customers do with the product, never a made-up quote.",
    ],
    picture: [
      "A designed review card: the quote large, star marks small, the product or a fictional customer photo beside it; trustworthy, warm, plenty of space.",
    ],
    carousel:
      "One review per slide, each with what they bought; last slide 'see why' and the action.",
    video: "The review as text on screen over the product in use; one review per Reel.",
    carouselStructure: "case-study",
  },
  {
    id: "behind-scenes",
    group: "trust",
    label: "Behind the scenes",
    tagline: "How it really gets made",
    glyph: "camera",
    whyItSpreads: "People trust what they see being made, and comment questions.",
    aim: "relate",
    goal: "awareness",
    formats: ["video", "story", "image", "carousel"],
    register: "native",
    write: [
      "Open in the middle of the work with one vivid detail, explain what customers never see, connect it to what they get. First person, warm.",
    ],
    picture: [
      "A real, candid phone photo of hands at work, the workshop, the packing table, the kitchen: real light, real mess, no posing.",
    ],
    carousel:
      "The process step by step, one real photo and one line per slide, the finished product last.",
    video: "Raw process clips with ASMR sound, quick cuts, the finished thing at the end.",
  },
  {
    id: "storytime",
    group: "trust",
    label: "Storytime",
    tagline: "A short true story",
    glyph: "book",
    whyItSpreads: "Stories hold attention to the end and make people feel something.",
    aim: "relate",
    goal: "engagement",
    formats: ["carousel", "social", "video", "image"],
    register: "native",
    write: [
      "A short true story the brand gave (a customer, the founder, a hard day): a hook that starts in the middle, a turn, the lesson in one line. Never invent the events.",
    ],
    picture: ["One candid photo that sets the scene of the story, with the hook line on it."],
    carousel:
      "Slide 1 the hook. Each slide moves the story one beat with one photo and two lines. Last slide the turn and the lesson.",
    video:
      "Talking to camera or voiceover over B-roll; the hook in the first line, the turn at the end.",
    carouselStructure: "story",
  },
  {
    id: "this-or-that",
    group: "fun",
    label: "This or that",
    tagline: "A quick choice people answer",
    glyph: "vote",
    whyItSpreads: "Everyone has an opinion: comments pour in when the answer is one word.",
    aim: "reply",
    goal: "engagement",
    formats: ["image", "story", "carousel", "video"],
    register: "designed",
    write: [
      "A real choice between two of the brand's products, flavours, styles or habits, and a playful line asking which one. No wrong answer.",
    ],
    picture: [
      "A clean designed split: two options side by side, the same light and angle, a big OR or VS between them, a short label on each.",
    ],
    carousel: "One choice per slide (this or that, a few rounds), last slide 'tell us your picks'.",
    video: "Rapid rounds: two options on screen, a beat to choose, the next round.",
  },
  {
    id: "quote",
    group: "trust",
    label: "Quote & mindset",
    tagline: "A line worth sharing",
    glyph: "quote",
    whyItSpreads: "People repost a line that says what they feel.",
    aim: "send",
    goal: "awareness",
    formats: ["image", "story", "carousel"],
    register: "designed",
    write: [
      "One short line (under 15 words) that the audience feels about their life or work, in the brand's voice. A real quote only if given, with its source.",
    ],
    picture: [
      "A typographic card: the line set beautifully and large on a calm field or a soft photo, the brand's type and colour, nothing else.",
    ],
    carousel:
      "Slide 1 the line. Then what it means in practice, one idea per slide. Last slide the brand's take.",
    video: "The line written on screen word by word over a calm moving shot.",
  },
  {
    id: "local",
    group: "trust",
    label: "Local & festive",
    tagline: "Your city, your season, your festival",
    glyph: "pin",
    whyItSpreads: "Local pride and festival moments get shared across a city's feeds.",
    aim: "send",
    goal: "awareness",
    formats: ["image", "video", "story", "carousel"],
    register: "designed",
    write: [
      "Tie the brand to a moment of the place it serves (the season, a festival, the weather, a local habit or food) using only moments in the brand context, the upcoming moments list, or everyday culture everyone there knows.",
      "Warm and specific to the place; greetings in the content language.",
    ],
    picture: [
      "A designed festive or local scene: the place's real colours, food, light and details, the product part of the moment, the greeting set small and well.",
    ],
    carousel:
      "Slide 1 the moment. Then how the brand's customers live it, one detail per slide. Last slide a greeting or an offer, only if given.",
    video: "The local moment's sounds and sights, the product part of it, a greeting at the end.",
  },
  {
    id: "aesthetic",
    group: "trust",
    label: "Aesthetic mood",
    tagline: "A feed-worthy, calm picture",
    glyph: "leaf",
    whyItSpreads: "Beautiful, calm pictures get saved to mood boards.",
    aim: "save",
    goal: "awareness",
    formats: ["image", "carousel", "video", "story"],
    register: "designed",
    write: [
      "Few words: a mood, a moment, a feeling. The caption is one short line and a question.",
    ],
    picture: [
      "An editorial, magazine-quality photograph: soft directional light, a considered colour story from the brand palette, real textures, the product placed quietly in a beautiful moment. No text on the picture.",
    ],
    carousel:
      "A photo dump of one mood: 5 to 7 cohesive pictures, no words on them, the product in a few.",
    video: "Slow, calm shots with natural sound, one mood, no text.",
  },
  {
    id: "ugc",
    group: "trust",
    label: "Customer-style photo",
    tagline: "Looks like a real customer posted it",
    glyph: "phone",
    whyItSpreads: "Posts that look made by customers feel honest and get trusted.",
    aim: "relate",
    goal: "leads",
    formats: ["image", "video", "story", "carousel"],
    register: "native",
    write: [
      "Write like a happy customer would caption their own photo: casual, first person, one detail they love. Never a quote put in a customer's mouth.",
    ],
    picture: [
      "A casual phone photo of a fictional customer using or holding the product in real life (a mirror selfie, a desk, a car, a kitchen counter), natural light, not posed.",
    ],
    carousel: "A casual photo dump of the product in a real day, a short line on a few slides.",
    video:
      "Handheld selfie-style clips of a fictional customer using it, talking or reacting, real sound.",
  },
];

/* ───────────────────────────── lookups ───────────────────────────── */

export function categoryById(id: unknown): Category | null {
  return CATEGORIES.find((c) => c.id === id) ?? null;
}

/** Categories that suit a format, best fits first, grouped in picker order. */
export function categoriesFor(type: StudioType): Category[] {
  const order = new Map(CATEGORY_GROUPS.map((g, i) => [g.id, i]));
  return CATEGORIES.filter((c) => c.formats.includes(type)).sort(
    (a, b) =>
      (order.get(a.group) ?? 0) - (order.get(b.group) ?? 0) ||
      a.formats.indexOf(type) - b.formats.indexOf(type),
  );
}

/** The category an existing template belongs to, so templates and categories agree. */
export const TEMPLATE_CATEGORY: Record<string, CategoryId> = {
  "social-hot-take": "myth",
  "social-behind-scenes": "behind-scenes",
  "social-customer-story": "storytime",
  "social-tips": "tips",
  "social-announcement": "launch",
  "social-ask-audience": "this-or-that",
  "carousel-step-by-step": "tips",
  "carousel-myth-fact": "myth",
  "carousel-mistakes": "tips",
  "carousel-before-after": "before-after",
  "carousel-checklist": "tips",
  "carousel-product-tour": "product",
  "carousel-case-study": "proof",
  "carousel-running-joke": "meme",
  "image-product-hero": "product",
  "image-quote-card": "quote",
  "image-lifestyle": "ugc",
  "image-offer": "sale",
  "image-review": "proof",
  "image-flat-lay": "aesthetic",
  "image-tip-card": "tips",
  "image-event": "local",
  "image-greeting": "local",
  "image-teaser": "launch",
  "ad-limited-offer": "sale",
  "ad-social-proof": "proof",
  "ad-launch": "launch",
  "video-product-reveal": "product",
  "video-process": "behind-scenes",
  "video-transformation": "before-after",
  "video-offer-teaser": "sale",
  "video-unboxing": "ugc",
  "script-pov": "relatable",
  "script-myth-reality": "myth",
  "script-day-in-life": "behind-scenes",
  "story-behind-scenes": "behind-scenes",
  "story-this-or-that": "this-or-that",
  "story-customer-win": "proof",
  "story-quick-tip": "tips",
  "story-announcement": "launch",
  // Templates added with the categories.
  "image-meme": "meme",
  "image-pov": "relatable",
  "image-this-or-that": "this-or-that",
  "image-before-after": "before-after",
  "carousel-meme-dump": "meme",
  "carousel-relatable": "relatable",
  "carousel-top-picks": "list",
  "carousel-sale": "sale",
  "carousel-photo-dump": "aesthetic",
  "video-meme-reel": "meme",
  "video-trend-remix": "trend",
  "story-meme": "meme",
};

export function categoryOfTemplate(templateId: string | null | undefined): CategoryId | null {
  return templateId ? (TEMPLATE_CATEGORY[templateId] ?? null) : null;
}

/** The category a piece follows: the person's pick, else its template's. */
export function resolveCategory(intent: {
  category?: string | null;
  template?: string | null;
}): Category | null {
  return categoryById(intent.category) ?? categoryById(categoryOfTemplate(intent.template));
}

/** How the picture is made: a category decides, else the polished default. */
export function registerFor(category: Category | null | undefined): Register {
  return category?.register ?? "designed";
}

/* ───────────────────────────── prompt text ───────────────────────────── */

function lines(items: readonly string[]): string {
  return items.map((s) => `- ${s}`).join("\n");
}

/** What a text writer is told about the category, for one format. */
export function categorySection(category: Category | null, type: StudioType): string | null {
  if (!category) return null;
  const how =
    type === "carousel"
      ? `Carousel: ${category.carousel}`
      : type === "video" || type === "script"
        ? `Video: ${category.video}`
        : null;
  const memes =
    category.id === "meme" && type !== "video" && type !== "script"
      ? `Meme layouts to choose from:\n${MEME_LAYOUTS.map((m) => `- ${m.id}: ${m.name}. ${m.layout}`).join("\n")}`
      : null;
  return [
    `${category.label}: ${category.tagline}. Why it spreads: ${category.whyItSpreads}`,
    "Write it as this kind of post, and keep everything the person asked for in the brief: their product, their offer, their words.",
    lines(category.write),
    how,
    memes,
    category.group === "fun" ? lines(VIRAL_RULES) : null,
    LOCAL_RULE,
    lines(NOT_GENERIC_RULES),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Fun posts only spread when the audience recognises the joke at once, and
 * only once: a new one every time, from this brand's own world.
 */
export const VIRAL_RULES: readonly string[] = [
  "Find the joke in this brand's own world: its customers' everyday life in their market, how the product is really used, what its customers complain about, and what people there are talking about this week (the timely signal and 'What is working right now', when given).",
  "When a current meme format or trend from 'What is working right now' fits this brand, build on its structure with the brand's own situation; never copy its words, its picture or a famous meme photo.",
  "Pick the angle most of the audience will recognise in one second; a joke only the brand finds funny never travels.",
  "A brand-new joke every time: never the situation, setup, punchline or pun of anything listed as already posted, even reworded.",
];

/** The picture's look for a category, as lines for the image prompt. */
export function categoryPictureLines(category: Category | null): string[] {
  if (!category) return [];
  return [
    ...(category.register === "native" ? NATIVE_PICTURE : DESIGNED_PICTURE),
    ...category.picture,
  ];
}

/* ───────────────────────────── picking one ───────────────────────────── */

/**
 * How often each category comes up for a goal when Write it for me picks.
 * Auto never makes a meme: a joke post is made only when a person picks Meme
 * (or a meme template).
 */
const GOAL_MIX: Partial<Record<GoalId, Partial<Record<CategoryId, number>>>> = {
  offer: { sale: 4, product: 2, "before-after": 1, proof: 1 },
  launch: { launch: 4, product: 2, trend: 1, "behind-scenes": 1 },
  leads: { proof: 3, "before-after": 2, tips: 2, ugc: 1 },
  education: { tips: 3, myth: 3, list: 2, "before-after": 1 },
  engagement: { relatable: 3, "this-or-that": 2, trend: 2, storytime: 1 },
  awareness: {
    relatable: 2,
    trend: 2,
    product: 2,
    aesthetic: 1,
    local: 1,
    "behind-scenes": 1,
    tips: 1,
  },
};

/** Kinds Auto never picks by itself: only a person's pick makes one. */
export const NEVER_AUTO: readonly CategoryId[] = ["meme"];

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The category Write it for me uses when the person picked none: weighted by
 * the goal, only ones that suit the format, never the last two used. `seed`
 * makes it vary per click while staying testable.
 */
export function pickCategory(args: {
  type: StudioType;
  goal?: GoalId | null;
  recent?: readonly (string | null | undefined)[];
  seed: string;
}): Category {
  const mix = GOAL_MIX[args.goal ?? "awareness"] ?? GOAL_MIX.awareness!;
  const recent = new Set((args.recent ?? []).filter(Boolean).slice(0, 2));
  const fits = (id: CategoryId) => !!categoryById(id)?.formats.includes(args.type);
  let pool = (Object.entries(mix) as [CategoryId, number][]).filter(
    ([id]) => fits(id) && !recent.has(id),
  );
  if (!pool.length)
    pool = categoriesFor(args.type)
      .filter((c) => !NEVER_AUTO.includes(c.id))
      .map((c) => [c.id, 1] as [CategoryId, number]);
  if (!pool.length) return CATEGORIES[0];
  const total = pool.reduce((sum, [, w]) => sum + w, 0);
  let roll = hash(args.seed) % total;
  for (const [id, weight] of pool) {
    if (roll < weight) return categoryById(id)!;
    roll -= weight;
  }
  return categoryById(pool[0][0])!;
}
