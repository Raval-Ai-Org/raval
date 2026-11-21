// Ready-made creators for Creator (UGC) video ads. Pure and browser-safe.
//
// A creator is a written persona, not a photo of a real person: the video
// model draws the same described person every time (`creatorPrompt`), and the
// picker shows a drawn portrait (`CreatorPortrait`) built from `portrait`.
// The brand's own people (Inspo → Media, "Person") are offered beside these
// and sent as a reference photo instead.
//
// Ids are stored on briefs and on the brand look (`look.video.creator`):
// add creators, never rename or remove an id.

import { CREATOR_PHOTO_IDS } from "./creator-photos";
import type { CreatorAge, CreatorVibe, SettingId } from "./options";

export type HairStyle = "short" | "long" | "bun" | "curly" | "buzz" | "bob" | "wavy" | "covered";

export type CreatorPortraitTraits = {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  top: string;
  backdrop: string;
  beard?: boolean;
  glasses?: boolean;
};

export type StockCreator = {
  id: string;
  name: string;
  gender: "woman" | "man";
  age: Exclude<CreatorAge, "any">;
  vibe: CreatorVibe;
  setting: SettingId;
  /** One short line shown under the name. */
  tagline: string;
  /** How the person looks, written for the video model. Never a real person. */
  look: string;
  /** Topics this creator fits; used only to suggest, never to refuse. */
  tags: readonly string[];
  portrait: CreatorPortraitTraits;
};

export const STOCK_CREATORS: readonly StockCreator[] = [
  {
    id: "maya",
    name: "Maya",
    gender: "woman",
    age: "25-34",
    vibe: "friendly",
    setting: "bathroom",
    tagline: "Skincare routines, honest takes",
    look: "light-medium skin, shoulder-length wavy brown hair, soft natural makeup, cream knit top",
    tags: ["beauty", "skincare", "cosmetic", "wellness", "self-care", "fashion"],
    portrait: {
      skin: "#e8b896",
      hair: "#5a3a22",
      hairStyle: "wavy",
      top: "#efe4d2",
      backdrop: "#f6dccf",
    },
  },
  {
    id: "jordan",
    name: "Jordan",
    gender: "man",
    age: "25-34",
    vibe: "hype",
    setting: "gym",
    tagline: "Training, supplements, energy",
    look: "deep brown skin, short fade haircut, athletic build, fitted black training t-shirt",
    tags: ["fitness", "gym", "supplement", "sport", "nutrition", "energy", "health"],
    portrait: {
      skin: "#7a4a2c",
      hair: "#1b1410",
      hairStyle: "buzz",
      top: "#1f2328",
      backdrop: "#dfe7c9",
    },
  },
  {
    id: "priya",
    name: "Priya",
    gender: "woman",
    age: "25-34",
    vibe: "expert",
    setting: "office",
    tagline: "Explains tools in plain words",
    look: "medium-brown skin, long straight black hair tied back, thin gold hoop earrings, navy blazer over a white tee",
    tags: ["saas", "software", "app", "tech", "b2b", "productivity", "finance", "education"],
    portrait: {
      skin: "#b07a52",
      hair: "#16110e",
      hairStyle: "long",
      top: "#27344f",
      backdrop: "#dbe3f3",
    },
  },
  {
    id: "lucas",
    name: "Lucas",
    gender: "man",
    age: "25-34",
    vibe: "relatable",
    setting: "home",
    tagline: "Everyday finds, no hype",
    look: "fair skin, short tousled light-brown hair, light stubble, grey crew-neck sweatshirt",
    tags: ["home", "gadget", "tech", "lifestyle", "coffee", "food", "ecommerce"],
    portrait: {
      skin: "#f0c9a8",
      hair: "#8a6440",
      hairStyle: "short",
      top: "#9aa0a6",
      backdrop: "#e7e2da",
      beard: true,
    },
  },
  {
    id: "amara",
    name: "Amara",
    gender: "woman",
    age: "18-24",
    vibe: "hype",
    setting: "bedroom",
    tagline: "Gen Z energy, fast hooks",
    look: "dark brown skin, voluminous natural curly hair, small nose ring, bright oversized yellow hoodie",
    tags: ["fashion", "beauty", "student", "gen z", "music", "app", "snack", "drink"],
    portrait: {
      skin: "#5e3a24",
      hair: "#120d0a",
      hairStyle: "curly",
      top: "#f2c94c",
      backdrop: "#f9e3ef",
    },
  },
  {
    id: "daniel",
    name: "Daniel",
    gender: "man",
    age: "35-44",
    vibe: "expert",
    setting: "office",
    tagline: "Founder-style, straight to the point",
    look: "light-olive skin, short dark hair with grey at the temples, neat short beard, light-blue oxford shirt",
    tags: ["b2b", "saas", "finance", "consulting", "agency", "software", "business", "marketing"],
    portrait: {
      skin: "#d9a982",
      hair: "#2a221d",
      hairStyle: "short",
      top: "#a9c4e6",
      backdrop: "#e4e9ef",
      beard: true,
    },
  },
  {
    id: "sofia",
    name: "Sofia",
    gender: "woman",
    age: "35-44",
    vibe: "calm",
    setting: "kitchen",
    tagline: "Busy-parent shortcuts",
    look: "warm olive skin, dark brown hair in a loose low bun, minimal makeup, sage-green linen shirt",
    tags: ["parent", "family", "kids", "food", "kitchen", "home", "baby", "cleaning"],
    portrait: {
      skin: "#c99a74",
      hair: "#3b2618",
      hairStyle: "bun",
      top: "#a9bfa2",
      backdrop: "#efe7da",
    },
  },
  {
    id: "kenji",
    name: "Kenji",
    gender: "man",
    age: "18-24",
    vibe: "friendly",
    setting: "bedroom",
    tagline: "Gaming setups and gadgets",
    look: "light skin with warm undertone, straight black hair with a medium fringe, round glasses, dark green zip hoodie",
    tags: ["tech", "gaming", "gadget", "app", "student", "audio", "software"],
    portrait: {
      skin: "#ecc7a0",
      hair: "#14110f",
      hairStyle: "short",
      top: "#2f4a3a",
      backdrop: "#dde4f0",
      glasses: true,
    },
  },
  {
    id: "leila",
    name: "Leila",
    gender: "woman",
    age: "25-34",
    vibe: "calm",
    setting: "home",
    tagline: "Modest style, thoughtful reviews",
    look: "medium skin, wearing a soft dusty-pink headscarf, light natural makeup, beige long-sleeve top",
    tags: ["fashion", "beauty", "modest", "skincare", "home", "lifestyle", "food"],
    portrait: {
      skin: "#c48e66",
      hair: "#d8a7a6",
      hairStyle: "covered",
      top: "#e2d3bf",
      backdrop: "#f3e3e1",
    },
  },
  {
    id: "marcus",
    name: "Marcus",
    gender: "man",
    age: "45-60",
    vibe: "calm",
    setting: "outdoors",
    tagline: "Trustworthy, been-there advice",
    look: "deep brown skin, closely cropped grey hair, short grey beard, olive field jacket over a white tee",
    tags: ["outdoor", "health", "finance", "insurance", "travel", "auto", "tools", "garden"],
    portrait: {
      skin: "#6b4128",
      hair: "#b9b4ad",
      hairStyle: "buzz",
      top: "#6d7448",
      backdrop: "#e3e8d6",
      beard: true,
    },
  },
  {
    id: "elena",
    name: "Elena",
    gender: "woman",
    age: "45-60",
    vibe: "friendly",
    setting: "kitchen",
    tagline: "Warm, real-life recommendations",
    look: "fair skin, chin-length silver-blonde bob, small pearl earrings, soft lavender cardigan",
    tags: ["health", "wellness", "food", "home", "skincare", "supplement", "travel", "garden"],
    portrait: {
      skin: "#f1cfb3",
      hair: "#d9cbb0",
      hairStyle: "bob",
      top: "#c8b6dd",
      backdrop: "#efe8f5",
    },
  },
  {
    id: "noah",
    name: "Noah",
    gender: "man",
    age: "25-34",
    vibe: "relatable",
    setting: "car",
    tagline: "On-the-go, quick verdicts",
    look: "light-medium skin, short curly dark hair, clean-shaven, white t-shirt under an open denim shirt",
    tags: ["auto", "travel", "app", "drink", "snack", "audio", "insurance", "ecommerce"],
    portrait: {
      skin: "#d6a47d",
      hair: "#2a1d14",
      hairStyle: "curly",
      top: "#7b9cc4",
      backdrop: "#e5ecf3",
    },
  },
  {
    id: "zara",
    name: "Zara",
    gender: "woman",
    age: "18-24",
    vibe: "relatable",
    setting: "bedroom",
    tagline: "Unboxings and first reactions",
    look: "light skin with freckles, long straight copper-red hair, simple silver necklace, white ribbed tank under a light cardigan",
    tags: ["fashion", "beauty", "student", "jewelry", "ecommerce", "gift", "stationery"],
    portrait: {
      skin: "#f3d2b8",
      hair: "#b0532a",
      hairStyle: "long",
      top: "#f3eee6",
      backdrop: "#f7e1d6",
    },
  },
  {
    id: "omar",
    name: "Omar",
    gender: "man",
    age: "35-44",
    vibe: "friendly",
    setting: "kitchen",
    tagline: "Food, coffee and home cooking",
    look: "medium-brown skin, short black hair, full neatly trimmed black beard, rust-orange apron over a grey tee",
    tags: ["food", "coffee", "restaurant", "kitchen", "cooking", "drink", "local"],
    portrait: {
      skin: "#a8724c",
      hair: "#16110d",
      hairStyle: "short",
      top: "#c2683a",
      backdrop: "#f4e4d4",
      beard: true,
    },
  },
  {
    id: "chloe",
    name: "Chloe",
    gender: "woman",
    age: "25-34",
    vibe: "hype",
    setting: "gym",
    tagline: "Workouts, wellness, routines",
    look: "light skin, blonde hair in a high ponytail, light-grey sports top, small earbuds around her neck",
    tags: ["fitness", "wellness", "supplement", "sport", "nutrition", "drink", "health"],
    portrait: {
      skin: "#f2cdb0",
      hair: "#e0c27a",
      hairStyle: "bun",
      top: "#c9ced4",
      backdrop: "#e2f0e6",
    },
  },
  {
    id: "ravi",
    name: "Ravi",
    gender: "man",
    age: "25-34",
    vibe: "expert",
    setting: "office",
    tagline: "Money and productivity tips",
    look: "medium-brown skin, neat short black hair side-parted, clean-shaven, thin black-framed glasses, charcoal polo shirt",
    tags: ["finance", "fintech", "saas", "education", "productivity", "b2b", "app", "insurance"],
    portrait: {
      skin: "#a26f48",
      hair: "#110d0b",
      hairStyle: "short",
      top: "#3d4247",
      backdrop: "#dfe6ec",
      glasses: true,
    },
  },
  {
    id: "grace",
    name: "Grace",
    gender: "woman",
    age: "35-44",
    vibe: "expert",
    setting: "home",
    tagline: "Clinic-calm, evidence first",
    look: "deep brown skin, short natural coily hair, small stud earrings, crisp white shirt",
    tags: [
      "health",
      "clinic",
      "wellness",
      "skincare",
      "supplement",
      "dental",
      "medical",
      "education",
    ],
    portrait: {
      skin: "#5a3622",
      hair: "#0f0b09",
      hairStyle: "curly",
      top: "#f5f5f2",
      backdrop: "#e0eef0",
    },
  },
  {
    id: "theo",
    name: "Theo",
    gender: "man",
    age: "18-24",
    vibe: "hype",
    setting: "outdoors",
    tagline: "Streetwear and sneakers",
    look: "light-olive skin, wavy medium-length dark-blond hair, small silver chain, oversized black graphic-free hoodie",
    tags: ["fashion", "streetwear", "sneaker", "student", "music", "drink", "gen z"],
    portrait: {
      skin: "#e3b48c",
      hair: "#9c7a45",
      hairStyle: "wavy",
      top: "#24262a",
      backdrop: "#ece4f4",
    },
  },
  {
    id: "hana",
    name: "Hana",
    gender: "woman",
    age: "25-34",
    vibe: "calm",
    setting: "home",
    tagline: "Minimal, aesthetic home life",
    look: "fair skin, glossy straight black bob with a blunt fringe, minimal makeup, oatmeal oversized sweater",
    tags: ["home", "decor", "candle", "lifestyle", "tea", "stationery", "skincare", "fashion"],
    portrait: {
      skin: "#f1d1b6",
      hair: "#121011",
      hairStyle: "bob",
      top: "#d9cbb2",
      backdrop: "#f1ece4",
    },
  },
  {
    id: "sam",
    name: "Sam",
    gender: "man",
    age: "35-44",
    vibe: "relatable",
    setting: "home",
    tagline: "Dad-life, honest product tests",
    look: "fair skin, short receding light-brown hair, friendly crow's-feet smile, flannel shirt in muted blue check",
    tags: ["parent", "family", "home", "tools", "pet", "garden", "cleaning", "auto"],
    portrait: {
      skin: "#eec3a0",
      hair: "#7d5b3c",
      hairStyle: "short",
      top: "#5c7593",
      backdrop: "#e8e4dc",
      beard: true,
    },
  },
  {
    id: "isabel",
    name: "Isabel",
    gender: "woman",
    age: "25-34",
    vibe: "friendly",
    setting: "outdoors",
    tagline: "Travel, pets and outdoor days",
    look: "tan skin, long dark-brown hair in a loose braid, light freckles, rust-coloured utility jacket",
    tags: ["travel", "pet", "outdoor", "drink", "snack", "camera", "sport"],
    portrait: {
      skin: "#cf9a6e",
      hair: "#3a2416",
      hairStyle: "long",
      top: "#b4643a",
      backdrop: "#f3e6d4",
    },
  },
  {
    id: "ade",
    name: "Ade",
    gender: "man",
    age: "25-34",
    vibe: "friendly",
    setting: "home",
    tagline: "Grooming and self-care for men",
    look: "deep brown skin, short twists, well-groomed short beard, cream crew-neck sweater",
    tags: ["grooming", "skincare", "beauty", "fashion", "fragrance", "wellness", "self-care"],
    portrait: {
      skin: "#583420",
      hair: "#0d0a08",
      hairStyle: "curly",
      top: "#ece2cf",
      backdrop: "#efe6d8",
      beard: true,
    },
  },
  {
    id: "nina",
    name: "Nina",
    gender: "woman",
    age: "45-60",
    vibe: "expert",
    setting: "office",
    tagline: "Seasoned, credible, clear",
    look: "light skin, shoulder-length grey-brown hair, tortoiseshell glasses, structured camel blazer",
    tags: [
      "b2b",
      "finance",
      "consulting",
      "education",
      "health",
      "real estate",
      "insurance",
      "legal",
    ],
    portrait: {
      skin: "#ecc6a8",
      hair: "#8d7f72",
      hairStyle: "bob",
      top: "#b98c5a",
      backdrop: "#ece6dc",
      glasses: true,
    },
  },
  {
    id: "mateo",
    name: "Mateo",
    gender: "man",
    age: "18-24",
    vibe: "relatable",
    setting: "kitchen",
    tagline: "Student budget, real reviews",
    look: "tan skin, messy short dark-brown hair, light moustache, faded red t-shirt",
    tags: ["student", "food", "snack", "drink", "app", "gaming", "budget", "ecommerce"],
    portrait: {
      skin: "#c58f63",
      hair: "#2b1c12",
      hairStyle: "short",
      top: "#c0504d",
      backdrop: "#f2e1dc",
    },
  },
];

export const STOCK_CREATOR_IDS = STOCK_CREATORS.map((c) => c.id) as [string, ...string[]];

/** The creator's generated photo under /public, or null when it has none yet. */
export function creatorPhotoPath(id: string): string | null {
  return CREATOR_PHOTO_IDS.includes(id) ? `creators/${id}.jpg` : null;
}

/** Ready-made creators with a photo first, then the drawn ones, each in catalogue order. */
export function creatorsInOrder(list: readonly StockCreator[] = STOCK_CREATORS): StockCreator[] {
  return [...list].sort(
    (a, b) => Number(!!creatorPhotoPath(b.id)) - Number(!!creatorPhotoPath(a.id)),
  );
}

export function stockCreator(id: string | null | undefined): StockCreator | null {
  if (!id) return null;
  return STOCK_CREATORS.find((c) => c.id === id) ?? null;
}

/** The creator line for the video model: one described person, kept the same. */
export function creatorPrompt(c: StockCreator): string {
  const who = c.gender === "woman" ? "woman" : "man";
  return `${c.name}, a ${who} aged ${c.age.replace("-", " to ")}: ${c.look}.`;
}

export type CreatorFilter = "suggested" | "all" | "woman" | "man";

export function filterCreators(
  list: readonly StockCreator[],
  filter: CreatorFilter,
  query: string,
  suggested: readonly string[] = [],
): StockCreator[] {
  const q = query.trim().toLowerCase();
  const byFilter =
    filter === "suggested"
      ? suggested.map((id) => list.find((c) => c.id === id)).filter((c): c is StockCreator => !!c)
      : filter === "all"
        ? [...list]
        : list.filter((c) => c.gender === filter);
  if (!q) return byFilter;
  return byFilter.filter((c) =>
    [c.name, c.tagline, c.look, c.vibe, c.age, ...c.tags].some((s) => s.toLowerCase().includes(q)),
  );
}

export type BrandProfile = {
  industry?: string | null;
  audience?: string | null;
  audienceTags?: readonly string[] | null;
  /** Product names and categories from the Brand DNA catalogue. */
  products?: readonly string[] | null;
};

const AGE_HINTS: Array<[RegExp, StockCreator["age"]]> = [
  [/\b(gen ?z|students?|teens?|college|university|young adults?)\b/i, "18-24"],
  [/\b(millennials?|young professionals?|new parents?)\b/i, "25-34"],
  [/\b(parents?|moms?|mums?|dads?|families|managers?|founders?)\b/i, "35-44"],
  [/\b(retirees?|seniors?|over ?50|50\+|boomers?|grandparents?)\b/i, "45-60"],
];

/**
 * Creators that fit the brand, best first: topic words from the industry,
 * audience and products, plus age and gender hints in the audience. Pure
 * string work, no model call. Returns at most `limit` ids, only ones with a
 * real match.
 */
export function suggestCreators(profile: BrandProfile, limit = 6): string[] {
  const text = [
    profile.industry ?? "",
    profile.audience ?? "",
    ...(profile.audienceTags ?? []),
    ...(profile.products ?? []),
  ]
    .join(" ")
    .toLowerCase();
  if (!text.trim()) return [];
  const audience = `${profile.audience ?? ""} ${(profile.audienceTags ?? []).join(" ")}`;
  const ages = AGE_HINTS.filter(([re]) => re.test(audience)).map(([, age]) => age);
  const women = /\b(women|woman|female|moms?|mums?|her)\b/i.test(audience);
  const men = /\b(men|man|male|dads?|his)\b/i.test(audience);

  const scored = STOCK_CREATORS.map((c, index) => {
    let score = 0;
    for (const tag of c.tags) if (text.includes(tag)) score += 3;
    if (ages.includes(c.age)) score += 2;
    if (women && !men && c.gender === "woman") score += 2;
    if (men && !women && c.gender === "man") score += 2;
    return { id: c.id, score, index };
  })
    .filter((s) => s.score >= 3)
    // Among relevant creators, the ones with a real photo come first.
    .map((s) => ({ ...s, rank: s.score + (creatorPhotoPath(s.id) ? 3 : 0) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.id);
}

/** The brand's fixed creator, as stored on `look.video.creator`. */
export type BrandCreatorRef = { id?: string; personAssetId?: string; name?: string };

export function sameCreator(
  a: BrandCreatorRef | null | undefined,
  b: BrandCreatorRef | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  if (a.personAssetId && b.personAssetId) return a.personAssetId === b.personAssetId;
  return false;
}

/* ── Photos of original people ─────────────────────────────────────────── */

export type CreatorPhotoInput = {
  gender: "woman" | "man" | "person";
  age: Exclude<CreatorAge, "any"> | "any";
  /** How they look, in plain words. */
  look: string;
  /** Where they are (a SETTINGS prompt), or "" for a lived-in home. */
  place: string;
};

/**
 * The image prompt for a creator's photo: a natural phone selfie of an
 * original, fictional person, like a frame from a Reel. Used by the staff
 * script for the ready-made creators and by "Create your own creator".
 */
export function creatorPhotoPrompt(c: CreatorPhotoInput): string {
  const age = c.age === "any" ? "" : ` aged ${c.age.replace("-", " to ")}`;
  return [
    `Candid vertical smartphone photo of an original, fictional everyday content creator: a ${c.gender}${age}, ${c.look.trim().replace(/\.$/, "")}.`,
    `They are in ${c.place || "a lived-in home"}, holding the phone at arm's length and talking to its front camera mid-sentence, relaxed and natural, a small genuine smile.`,
    "Head and shoulders framing, face centred in the upper half, eyes to the lens.",
    "Looks like a real frame from an Instagram Reel or TikTok: natural window light, true-to-life colour, real skin texture with pores, no retouching, no heavy makeup, slight phone-camera softness, background softly out of focus.",
    "Not a celebrity and not resembling any real, identifiable person. No text, captions, logos, watermarks, stickers or props with brand names. Nothing in their hands.",
  ].join(" ");
}

const LOOKALIKE =
  /\b(looks?\s+like|lookalike|look-alike|resembl\w*|celebrit\w*|famous|impersonat\w*|deepfake|same face as|twin of)\b/i;

/** Why a description can't become a creator, or null. A creator is never someone real. */
export function customCreatorProblem(name: string, look: string): string | null {
  if (!name.trim()) return "Give your creator a name.";
  if (look.trim().length < 12) return "Describe how they look in a few words.";
  if (LOOKALIKE.test(`${name} ${look}`))
    return "Describe an original person. Creators can't look like a real or famous person.";
  return null;
}
