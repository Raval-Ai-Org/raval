// How a campaign looks on its card: a real photograph of the moment (Diwali
// lamps, an Eid table, a Christmas tree…), a Mellox icon and a soft wash of
// two colours, picked from the campaign's name and, failing that, from its
// kind. Pure and browser-safe; it only decorates. No emoji, ever.
//
// Photos live in /public/campaigns/<photo>.webp. Every one is public domain or
// CC0 (Wikimedia Commons), listed with its source in
// /public/campaigns/CREDITS.md. Add a moment here, never rename one: the art is
// matched by keyword.

/** Names of icons from `@/components/icons` (resolved by the Campaigns kit). */
export type CampaignIconName =
  | "Rocket"
  | "CalendarDays"
  | "Snowflake"
  | "Tag"
  | "Sparkles"
  | "Lightbulb"
  | "Smile"
  | "Camera"
  | "Star"
  | "Gift"
  | "Download"
  | "Handshake"
  | "Trophy"
  | "MapPin"
  | "Users"
  | "Heart"
  | "Megaphone"
  | "Sun"
  | "Moon"
  | "Leaf"
  | "Store"
  | "Laptop"
  | "Flag"
  | "Target"
  | "TrendingUp"
  | "Globe"
  | "GraduationCap"
  | "Gem"
  | "Briefcase";

export type CampaignTheme = {
  icon: CampaignIconName;
  /** File name (no extension) of the photo in /public/campaigns. */
  photo: string;
  /** The wash behind the art, as two CSS colours. */
  from: string;
  to: string;
};

/** Where a theme's photo is served from. */
export function campaignPhotoUrl(photo: string): string {
  return `/campaigns/${photo}.webp`;
}

type Rule = { match: RegExp } & CampaignTheme;

const m = (
  match: RegExp,
  photo: string,
  icon: CampaignIconName,
  from: string,
  to: string,
): Rule => ({ match, photo, icon, from, to });

// Order matters: the first match wins, so specific names come before broad
// ones ("Eid al-Adha" before "Eid", "Pakistan Day" before "national day").
const MOMENTS: readonly Rule[] = [
  m(/hallowe/i, "halloween", "Moon", "#ff9a3c", "#6b3fa0"),
  m(/diwali|deepavali/i, "diwali", "Sparkles", "#ffb347", "#e0457b"),
  m(/black friday/i, "black-friday", "Tag", "#2b2b2b", "#5a5a5a"),
  m(/cyber monday/i, "cyber-monday", "Laptop", "#2f6bff", "#7a3cff"),
  m(/small business/i, "small-business", "Store", "#3ec97a", "#1f8a70"),
  m(/giving tuesday/i, "giving-tuesday", "Heart", "#ff7aa8", "#ffb86b"),
  m(/hanukk?ah|chanukah/i, "hanukkah", "Sparkles", "#2f6bff", "#9bc1ff"),
  m(
    /christmas|xmas|holiday season|holidays|boxing day/i,
    "christmas",
    "Gift",
    "#d6334b",
    "#1f8a4c",
  ),
  m(
    /lunar new year|chinese new year|spring festival/i,
    "lunar-new-year",
    "Sparkles",
    "#d62828",
    "#f77f00",
  ),
  m(/new year|nye\b/i, "new-year", "Sparkles", "#ffd166", "#5b4bdb"),
  m(/year in review|wrapped/i, "year-in-review", "TrendingUp", "#7a5cff", "#2ec4b6"),
  m(/valentine/i, "valentines", "Heart", "#ff5c8a", "#ff9eb5"),
  m(/women'?s day|women'?s history/i, "womens-day", "Users", "#a259ff", "#ff7ac6"),
  m(/ramadan|ramzan|iftar/i, "ramadan", "Moon", "#24306b", "#c9a227"),
  m(/eid al-?adha|eid ul-?adha|bakr|qurban/i, "eid-adha", "Moon", "#1f8a70", "#c9a227"),
  m(/\beid\b/i, "eid-fitr", "Moon", "#1f8a70", "#c9a227"),
  m(/easter/i, "easter", "Gift", "#ffd6e8", "#b8e986"),
  m(/earth day|earth hour|environment day/i, "earth-day", "Leaf", "#3ec97a", "#2f80ed"),
  m(/mother'?s day/i, "mothers-day", "Heart", "#ff8fb1", "#ffc9a8"),
  m(/father'?s day/i, "fathers-day", "Gift", "#2f80ed", "#56ccf2"),
  m(/back to school/i, "back-to-school", "GraduationCap", "#ffb703", "#219ebc"),
  m(/graduat/i, "graduation", "GraduationCap", "#24306b", "#ffb703"),
  m(/teacher/i, "teachers-day", "GraduationCap", "#ffb703", "#06d6a0"),
  m(/mid-?year/i, "mid-year", "Target", "#2ec4b6", "#7a5cff"),
  m(/q[1-4]\b|planning season/i, "q4-planning", "CalendarDays", "#ff9f1c", "#2ec4b6"),
  m(/thanksgiving/i, "thanksgiving", "Heart", "#e76f51", "#9c6644"),
  m(/pride/i, "pride", "Flag", "#ff5c8a", "#5b8cff"),
  m(/\bholi\b/i, "holi", "Sparkles", "#ff4fa0", "#ffd23f"),
  m(/navratri|garba|dussehra|durga/i, "navratri", "Sparkles", "#ff7a00", "#d6334b"),
  m(/raksha|rakhi/i, "raksha-bandhan", "Heart", "#ff7a00", "#ffd166"),
  m(/ganesh|ganpati/i, "ganesh-chaturthi", "Sparkles", "#ff7a00", "#ffd166"),
  m(/mid-?autumn|moon ?cake/i, "mid-autumn", "Moon", "#ffb703", "#d62828"),
  m(/songkran|water festival/i, "songkran", "Sun", "#2f80ed", "#56ccf2"),
  m(/pakistan|14 august|23 march/i, "pakistan-day", "Flag", "#01411c", "#3ec97a"),
  m(/4th of july|fourth of july|july 4/i, "fourth-of-july", "Flag", "#2f80ed", "#eb5757"),
  m(
    /independence|national day|republic day|liberation day/i,
    "independence",
    "Flag",
    "#2f80ed",
    "#eb5757",
  ),
  m(/st\.? patrick|paddy/i, "st-patricks", "Leaf", "#1f8a4c", "#a7d676"),
  m(/mardi gras|carnival|carnaval/i, "mardi-gras", "Sparkles", "#7a3cff", "#ffd166"),
  m(/cinco de mayo/i, "cinco-de-mayo", "Sparkles", "#1f8a4c", "#d6334b"),
  m(/oktoberfest/i, "oktoberfest", "Sparkles", "#2f80ed", "#ffd166"),
  m(/super bowl|game day|nfl/i, "game-day", "Trophy", "#1f8a4c", "#24306b"),
  m(
    /world cup|football|soccer|cricket|olympic|euros?\b/i,
    "world-cup",
    "Trophy",
    "#1f8a4c",
    "#2f80ed",
  ),
  m(/black history/i, "black-history", "Users", "#2b2b2b", "#c9a227"),
  m(/labou?r day|may day|workers'? day/i, "labor-day", "Users", "#2f80ed", "#eb5757"),
  m(/memorial day|veterans|remembrance/i, "memorial-day", "Flag", "#24306b", "#eb5757"),
  m(/wedding|bridal/i, "wedding", "Heart", "#ffc9a8", "#ff8fb1"),
  m(/birthday|anniversary/i, "birthday", "Gift", "#ff7ac6", "#ffd166"),
  m(/pink october|breast cancer|pinktober/i, "pink-october", "Heart", "#ff5c8a", "#ffc9d6"),
  m(/summer/i, "summer", "Sun", "#ffbe0b", "#fb5607"),
  m(/spring/i, "spring", "Leaf", "#ffafcc", "#a7d676"),
  m(/autumn|fall\b/i, "autumn", "Leaf", "#e76f51", "#f4a261"),
  m(/winter/i, "winter", "Snowflake", "#a2d2ff", "#5e60ce"),
];

const k = (photo: string, icon: CampaignIconName, from: string, to: string): CampaignTheme => ({
  photo,
  icon,
  from,
  to,
});

const KINDS: Record<string, CampaignTheme> = {
  "product-launch": k("kind-product-launch", "Rocket", "#7a5cff", "#2ec4b6"),
  event: k("kind-event", "CalendarDays", "#2f80ed", "#9b51e0"),
  seasonal: k("kind-seasonal", "Snowflake", "#ff9f1c", "#2ec4b6"),
  sale: k("kind-sale", "Tag", "#ff5c5c", "#ffb347"),
  showcase: k("kind-showcase", "Sparkles", "#a259ff", "#ff7ac6"),
  teach: k("kind-teach", "Lightbulb", "#ffd166", "#06d6a0"),
  memes: k("kind-memes", "Smile", "#ffbe0b", "#ff006e"),
  "behind-scenes": k("kind-behind-scenes", "Camera", "#6c757d", "#2ec4b6"),
  "social-proof": k("kind-social-proof", "Star", "#ffd166", "#ef476f"),
  giveaway: k("kind-giveaway", "Gift", "#ef476f", "#ffd166"),
  "lead-magnet": k("kind-lead-magnet", "Download", "#118ab2", "#06d6a0"),
  collab: k("kind-collab", "Handshake", "#7a5cff", "#ff7ac6"),
  milestone: k("kind-milestone", "Trophy", "#ffb703", "#fb8500"),
  "grand-opening": k("kind-grand-opening", "MapPin", "#ef476f", "#ffd166"),
  hiring: k("kind-hiring", "Users", "#2f80ed", "#06d6a0"),
  "awareness-day": k("kind-awareness-day", "Heart", "#2f80ed", "#56ccf2"),
};

const DEFAULT_THEME: CampaignTheme = k("default", "Megaphone", "#2ee66b", "#18c7b9");

/** Every photo a theme can name, for checks. */
export function allCampaignPhotos(): string[] {
  return [
    ...new Set([
      ...MOMENTS.map((r) => r.photo),
      ...Object.values(KINDS).map((t) => t.photo),
      DEFAULT_THEME.photo,
    ]),
  ];
}

/** The look of a campaign card from its name (first) and its kind. */
export function campaignTheme(input: {
  title?: string | null;
  type?: string | null;
}): CampaignTheme {
  const title = input.title ?? "";
  const moment = MOMENTS.find((r) => r.match.test(title));
  if (moment) return { icon: moment.icon, photo: moment.photo, from: moment.from, to: moment.to };
  return (input.type && KINDS[input.type]) || DEFAULT_THEME;
}
