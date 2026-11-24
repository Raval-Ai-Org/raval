// type-voices.ts — each brand gets its own type (Round 9, ADR-0053). Pure.
//
// Studio used to tell every brand "heavy condensed sans, one accent word",
// so every post looked set in the same face. A type voice is a way of
// setting words that fits a kind of business: words an image model
// understands (no font names, which image models draw badly), plus a free
// Google Fonts pair the code-drawn slides use. Research and sources:
// docs/studio/research-2026-11/brands-design-type.md (Part 3).
//
// The choice is made once per brand, never rotated per piece: a feed that
// changes type every post looks like no brand at all.
//   1. the brand's own typography (Inspo look or style bible) wins;
//   2. else a display-worthy Brand DNA font (a UI sans like Inter is body only);
//   3. else a stable pick among the voices that fit the business.
// Ids are stored on posts (`meta.type_voice`) and in campaign controls: add,
// never rename.
import { catalogFont, fontKey } from "@/lib/brand-look/fonts";

export type TypeVoiceId =
  | "sturdy-grotesk"
  | "workwear-slab"
  | "condensed-punch"
  | "didone-luxe"
  | "garamond-calm"
  | "editorial-serif"
  | "swiss-grotesk"
  | "geometric-tech"
  | "dev-mono"
  | "humanist-care"
  | "classic-trust"
  | "warm-serif"
  | "chunky-serif"
  | "rounded-friendly"
  | "multiscript-soft"
  | "angular-gaming"
  | "arena-condensed"
  | "arcade-pixel"
  | "expressive-grotesk"
  | "studio-pair"
  | "festive-pop"
  | "deco-elegant"
  | "personal-note"
  | "quiet-minimal"
  | "bold-geo"
  | "heritage-slab"
  | "luxe-kufi";

export type TypeVoice = {
  id: TypeVoiceId;
  /** How the words are set, in image-model words. Never a font name. */
  describe: string;
  /** Scale and pairing, one short clause for the director. */
  setting: string;
  /** Businesses it fits (matched against the industry line and brand text). */
  fits: RegExp;
  /** Businesses it rings false for. */
  wrong: RegExp;
  /** Free Google Fonts pair for code-drawn slides (both in FONT_CATALOG). */
  headline: string;
  text: string;
  /** The headline face ships one weight: request 400, never fake a bold. */
  singleWeight?: boolean;
};

export const TYPE_VOICES: readonly TypeVoice[] = [
  {
    id: "sturdy-grotesk",
    describe: "very heavy, wide-set grotesque sans, low contrast, tight but not touching letters",
    setting: "headline 2 to 3 times the line size, five words at most",
    fits: /\b(plumb|electric|hvac|heating|roof|builder|construct|logistic|freight|courier|hardware|trade|sports club|moving|removal|handyman)/i,
    wrong: /\b(luxury|spa|florist|funeral|grief|bridal|perfume)/i,
    headline: "Archivo Black",
    text: "Barlow",
    singleWeight: true,
  },
  {
    id: "workwear-slab",
    describe: "sturdy slab serif with square blocky feet, medium-bold, even strokes, sentence case",
    setting: "slab headline, clean sans line, never long all-caps",
    fits: /\b(builder|carpent|joiner|auto repair|mechanic|garage|butcher|roaster|outdoor|landscap|farm|workshop|plumb)/i,
    wrong: /\b(fashion|fintech|skincare|cosmetic|software)/i,
    headline: "Roboto Slab",
    text: "Barlow",
  },
  {
    id: "condensed-punch",
    describe: "tall, narrow, ultra-bold sans in capitals, tight tracking, poster-like",
    setting: "only for one to four words, a wider plain sans for any second line",
    fits: /\b(sale|street food|nightlife|club night|boxing|mma|combat|festival|burger)/i,
    wrong: /\b(clinic|therap|care|luxury|law|account|spa|wedding)/i,
    headline: "Anton",
    text: "Barlow",
    singleWeight: true,
  },
  {
    id: "didone-luxe",
    describe:
      "high-contrast fashion serif, hairline strokes and thick verticals, elegant spacious capitals",
    setting: "set large and short, small spaced sans capitals beneath, lots of space",
    fits: /\b(jewel|perfume|fragrance|couture|bridal|luxury|haute|watch|diamond|gold)/i,
    wrong: /\b(budget|discount|kids|toy|gaming|software|plumb)/i,
    headline: "Bodoni Moda",
    text: "Jost",
  },
  {
    id: "garamond-calm",
    describe:
      "graceful old-style serif, soft contrast, long ascenders, sentence case with a quiet italic",
    setting: "bold enough to read on photos, a small clean sans for details",
    fits: /\b(florist|flower|wedding|wellness|bakery|patisserie|book|therap|counsel|yoga|retreat)/i,
    wrong: /\b(discount|gaming|esport|construct|hardware)/i,
    headline: "Cormorant Garamond",
    text: "Montserrat",
  },
  {
    id: "editorial-serif",
    describe: "magazine display serif, high contrast, sharp wedge serifs, bold, tight lines",
    setting: "large headline with a short italic line, thin rules",
    fits: /\b(restaurant|fine dining|interior|furniture|fashion|editorial|magazine|consult|founder|gallery|architect)/i,
    wrong: /\b(kids|toy|gaming|esport|utility|discount)/i,
    headline: "Playfair Display",
    text: "Work Sans",
  },
  {
    id: "swiss-grotesk",
    describe: "neutral, precise grotesque sans, medium-bold, flush left on a strict grid",
    setting: "two sizes only, weight contrast instead of colour",
    fits: /\b(architect|agency|studio|saas|software|b2b|gallery|clinic|engineer|consult|design)/i,
    wrong: /\b(kids|toy|sweets|festive|party)/i,
    headline: "Schibsted Grotesk",
    text: "Inter",
  },
  {
    id: "geometric-tech",
    describe: "clean geometric sans with open round shapes, semi-bold, slightly tight tracking",
    setting: "short lines, pairs with real product screens",
    fits: /\b(startup|fintech|app|saas|telecom|software|ai\b|platform|payments?|bank)/i,
    wrong: /\b(heritage|artisan|couture|handmade|antique)/i,
    headline: "Manrope",
    text: "Inter",
  },
  {
    id: "dev-mono",
    describe: "quirky technical grotesk headline with an evenly spaced code-style line",
    setting: "the code-style face only for labels, numbers and tags",
    fits: /\b(developer|dev tools?|web dev|web development|it services|data|cloud|hosting|cyber|security|hackathon|api|electronics|software house)/i,
    wrong: /\b(food|beauty|salon|spa|hotel|wedding)/i,
    headline: "Space Grotesk",
    text: "JetBrains Mono",
  },
  {
    id: "humanist-care",
    describe: "warm humanist sans, open rounded forms, gentle, sentence case, comfortable spacing",
    setting: "generous line spacing, never all capitals",
    fits: /\b(health|dental|dentist|clinic|pharmac|ngo|charity|nonprofit|school|insurance|care home|nursing|physio|doctor|hospital)/i,
    wrong: /\b(streetwear|nightlife|club|luxury)/i,
    headline: "Nunito Sans",
    text: "Source Sans 3",
  },
  {
    id: "classic-trust",
    describe: "traditional book serif, moderate contrast, sturdy and readable, sentence case",
    setting: "serif headline, plain sans line, small capitals for labels",
    fits: /\b(law|legal|solicitor|attorney|account|tax|audit|finance|wealth|universit|real estate|property|publish)/i,
    wrong: /\b(gaming|esport|food truck|kids|toy|streetwear)/i,
    headline: "Libre Baskerville",
    text: "IBM Plex Sans",
  },
  {
    id: "warm-serif",
    describe: "soft, friendly display serif with gentle curves, chunky-medium, a slight quirk",
    setting: "large headline, one italic word may add charm",
    fits: /\b(bakery|coffee|cafe|café|organic|independent shop|lifestyle|wellness|tea|deli|grocer)/i,
    wrong: /\b(bank|enterprise|b2b|cyber|security)/i,
    headline: "Fraunces",
    text: "DM Sans",
  },
  {
    id: "chunky-serif",
    describe: "bold display serif with ball terminals, strong contrast, rounded weight, confident",
    setting: "headlines of six words at most, on saturated colour",
    fits: /\b(restaurant|ice cream|dessert|confection|chocolate|cosmetic|makeup|candy|diner|pizza)/i,
    wrong: /\b(medical|legal|law|precision|engineer)/i,
    headline: "DM Serif Display",
    text: "Outfit",
    singleWeight: true,
  },
  {
    id: "rounded-friendly",
    describe: "rounded, bubbly sans with soft terminals, bold, playful but clean",
    setting: "bold headline, plenty of padding inside shapes",
    fits: /\b(kids|child|toy|pet|snack|nursery|preschool|family|daycare|learning app)/i,
    wrong: /\b(luxury|finance|funeral|law|oncolog)/i,
    headline: "Fredoka",
    text: "Nunito",
  },
  {
    id: "multiscript-soft",
    describe: "soft rounded sans that sits happily beside Devanagari, bold, open counters",
    setting: "both scripts at matched optical size, never squeeze the Indic line",
    fits: /\b(hindi|devanagari|india|desi|mithai|kirana|diwali|edtech)/i,
    wrong: /\b(luxury|couture|minimal)/i,
    headline: "Baloo 2",
    text: "Mukta",
  },
  {
    id: "angular-gaming",
    describe:
      "angular techno sans with clipped corners and squared curves, bold capitals, sci-fi feel",
    setting: "slightly tracked capitals on a dark ground with one neon accent",
    fits: /\b(gam(e|ing)|esport|game studio|pc build|electronics|motorsport|stream(er|ing)|console)/i,
    wrong: /\b(food|beauty|care|wedding|florist)/i,
    headline: "Chakra Petch",
    text: "Rajdhani",
  },
  {
    id: "arena-condensed",
    describe:
      "tall, clean condensed sans in capitals, even strokes, slightly tracked, stadium-signage feel",
    setting: "short capitals, big numerals work",
    fits: /\b(sport|fitness|gym|crossfit|event|cinema|music night|football|cricket|tournament|league)/i,
    wrong: /\b(care|therap|craft|luxury|spa)/i,
    headline: "Bebas Neue",
    text: "Barlow Condensed",
    singleWeight: true,
  },
  {
    id: "arcade-pixel",
    describe: "chunky pixel-grid letters like an 8-bit screen, crisp square edges",
    setting: "pixel letters only for the headline, flat bright colour behind",
    fits: /\b(retro gam|arcade|indie game|pixel|8-bit|toy shop|nostalgi)/i,
    wrong: /\b(law|finance|clinic|luxury|funeral)/i,
    headline: "Pixelify Sans",
    text: "Space Mono",
  },
  {
    id: "expressive-grotesk",
    describe:
      "characterful grotesque sans with ink-trap quirks, bold, slightly condensed, contemporary",
    setting: "very large headline with generous empty space",
    fits: /\b(creative|studio|fashion|culture|media|podcast|record|streetwear|brand agency|marketing agency|modern food)/i,
    wrong: /\b(bank|law|legal|retire|elderly)/i,
    headline: "Bricolage Grotesque",
    text: "DM Sans",
  },
  {
    id: "studio-pair",
    describe: "refined narrow serif with a sleek modern sans companion, light, tall, airy",
    setting: "serif only large, sans for small labels, restrained colour",
    fits: /\b(design studio|architect|skincare|serum|fashion|gallery|ceramic|interior)/i,
    wrong: /\b(sale|discount|kids|gaming|plumb)/i,
    headline: "Instrument Serif",
    text: "Instrument Sans",
    singleWeight: true,
  },
  {
    id: "festive-pop",
    describe: "fat, bouncy, rounded display letters, ultra-heavy, cheerful and inflated",
    setting: "one burst word, a rounded sans for the rest",
    fits: /\b(festival|sweets?|mithai|toy|celebrat|party|balloon|eid|diwali|carnival)/i,
    wrong: /\b(law|account|clinic|funeral|luxury|b2b)/i,
    headline: "Bagel Fat One",
    text: "Rubik",
    singleWeight: true,
  },
  {
    id: "deco-elegant",
    describe:
      "elegant flared-serif capitals like a classical inscription, wide tracking, art-deco air",
    setting: "spaced capitals, symmetric, gold or black on ivory",
    fits: /\b(hotel|salon|spa|interior|event venue|perfume|banquet|lounge|resort)/i,
    wrong: /\b(discount|software|kids|gaming)/i,
    headline: "Marcellus",
    text: "Josefin Sans",
    singleWeight: true,
  },
  {
    id: "personal-note",
    describe: "warm, slightly old-fashioned serif with soft heavy strokes, friendly and sincere",
    setting: "simple left-aligned layout, like a letter",
    fits: /\b(founder|coach|bookshop|cafe|café|thank|independent|tutor|mentor)/i,
    wrong: /\b(enterprise|mega sale|launch event|esport)/i,
    headline: "Young Serif",
    text: "Karla",
    singleWeight: true,
  },
  {
    id: "quiet-minimal",
    describe: "clean low-contrast sans, regular to medium weight, generous spacing, understated",
    setting: "small type and big margins, weight contrast only",
    fits: /\b(minimal|ceramic|architect|wellness|premium basics|furniture|candle|homeware)/i,
    wrong: /\b(sale|festive|gaming|kids|nightlife)/i,
    headline: "DM Sans",
    text: "Manrope",
  },
  {
    id: "bold-geo",
    describe: "wide, extended geometric sans, very bold, rounded-square shapes, loud capitals",
    setting: "short wide headline of four words at most, strong colour blocks",
    fits: /\b(music|dj|event|streetwear|web3|crypto|youth|sneaker|nightclub)/i,
    wrong: /\b(heritage|care|legal|law|clinic)/i,
    headline: "Unbounded",
    text: "Figtree",
  },
  {
    id: "heritage-slab",
    describe: "heavy chunky slab serif with bold square feet, old poster and print-shop feel",
    setting: "one heavy headline weight, cream, red or navy grounds",
    fits: /\b(barber|brewer|bbq|barbecue|smokehouse|workwear|market|heritage|whisk(e)?y|tailor)/i,
    wrong: /\b(software|tech|minimal|skincare)/i,
    headline: "Alfa Slab One",
    text: "Arvo",
    singleWeight: true,
  },
  {
    id: "luxe-kufi",
    describe:
      "geometric Kufic-style Arabic with matching clean Latin, structured square forms, refined",
    setting: "Arabic and Latin at equal weight, aligned on the visual centre",
    fits: /\b(arabic|gulf|dubai|uae|saudi|qatar|abaya|oud|dates|bakhoor)/i,
    wrong: /\b(kids|gaming|esport)/i,
    headline: "Reem Kufi",
    text: "Tajawal",
  },
];

const BY_ID = new Map(TYPE_VOICES.map((v) => [v.id, v]));

export function typeVoiceById(id: string | null | undefined): TypeVoice | null {
  return id ? (BY_ID.get(id as TypeVoiceId) ?? null) : null;
}

/** Voices a business with nothing specific gets, picked by a stable hash. */
const GENERAL: readonly TypeVoiceId[] = [
  "swiss-grotesk",
  "editorial-serif",
  "expressive-grotesk",
  "warm-serif",
  "geometric-tech",
  "quiet-minimal",
];

/** UI sans faces: fine for body text, never the brand's display voice. */
const UI_SANS = new Set(
  [
    "Inter",
    "Roboto",
    "Open Sans",
    "Lato",
    "Arial",
    "Helvetica",
    "Noto Sans",
    "Source Sans 3",
    "PT Sans",
    "IBM Plex Sans",
    "Public Sans",
    "System UI",
    "Geist",
    "Segoe UI",
  ].map(fontKey),
);

/** A family good enough to set the brand's headlines in (not a UI sans). */
export function isDisplayWorthy(family: string | null | undefined): boolean {
  if (!family?.trim()) return false;
  return !UI_SANS.has(fontKey(family));
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Voices that fit this business, best first (string work on its industry and text). */
export function voicesFor(business: string): TypeVoice[] {
  const text = business.slice(0, 2000);
  const fitting = TYPE_VOICES.filter((v) => v.fits.test(text) && !v.wrong.test(text));
  if (fitting.length) return fitting;
  return GENERAL.map((id) => BY_ID.get(id)!).filter((v) => !v.wrong.test(text));
}

export type TypeChoice =
  { kind: "own"; headline: string; text?: string } | { kind: "voice"; voice: TypeVoice };

/**
 * The brand's type, decided once per brand. Its own typography wins; then a
 * display-worthy Brand DNA font; then a stable pick among the voices that
 * fit (the workspace id keeps it the same on every post).
 */
export function pickTypeVoice(args: {
  workspaceId: string;
  /** Industry line plus the start of the brand text. */
  business: string;
  /** The Inspo look or style bible's headline family, when it has one. */
  ownHeadline?: string | null;
  ownText?: string | null;
  /** Brand DNA fonts, headline first. */
  dnaFonts?: readonly (string | null | undefined)[];
  /** A stored voice (a campaign's, or one a person chose): kept when valid. */
  stored?: string | null;
  /** Voices the brand's researched sector suits, best first (sector playbooks). */
  preferred?: readonly string[];
}): TypeChoice {
  const stored = typeVoiceById(args.stored);
  if (stored) return { kind: "voice", voice: stored };
  if (isDisplayWorthy(args.ownHeadline))
    return {
      kind: "own",
      headline: args.ownHeadline!.trim(),
      text: args.ownText?.trim() || undefined,
    };
  const dnaHeadline = (args.dnaFonts ?? []).find((f) => isDisplayWorthy(f));
  if (dnaHeadline) {
    const body = (args.dnaFonts ?? []).find((f) => f && f !== dnaHeadline);
    return { kind: "own", headline: dnaHeadline.trim(), text: body?.trim() || undefined };
  }
  const preferred = (args.preferred ?? [])
    .map((id) => typeVoiceById(id))
    .filter((v): v is TypeVoice => !!v);
  const list = preferred.length ? preferred : voicesFor(args.business);
  const top = list.slice(0, 3);
  return { kind: "voice", voice: top[hash(`${args.workspaceId}:type`) % top.length] };
}

/**
 * One line for the director (the Business section), at most about 200
 * characters. Taste, not orders; never a font name for a voice.
 */
export function typeVoiceLine(choice: TypeChoice): string {
  if (choice.kind === "own")
    return `Type voice: the brand's own headline face (${choice.headline.slice(0, 40)}) in every post; describe its character, set big, one weight.`;
  return `Type voice: ${choice.voice.describe}; ${choice.voice.setting}.`;
}

/** The font pair code-drawn slides use when the brand names none. */
export function typeVoiceFonts(choice: TypeChoice): { heading: string; body: string } {
  if (choice.kind === "own") {
    const heading = catalogFont(choice.headline)?.family ?? choice.headline;
    return { heading, body: catalogFont(choice.text)?.family ?? choice.text ?? heading };
  }
  return { heading: choice.voice.headline, body: choice.voice.text };
}

/** The stored id of a choice (`meta.type_voice`); null for the brand's own. */
export function typeVoiceId(choice: TypeChoice): TypeVoiceId | null {
  return choice.kind === "voice" ? choice.voice.id : null;
}
