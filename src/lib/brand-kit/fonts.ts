// Font catalogue and loading helpers for Brand Kit Styles. Pure and
// browser-safe (the loader functions no-op on the server).

export type FontCategory = "sans" | "serif" | "display" | "mono" | "handwriting";

export type CatalogFont = { family: string; category: FontCategory };

const f = (category: FontCategory, families: string[]): CatalogFont[] =>
  families.map((family) => ({ family, category }));

/** Curated Google Fonts families. Every entry exists on fonts.google.com. */
export const FONT_CATALOG: readonly CatalogFont[] = [
  ...f("sans", [
    "Inter",
    "Roboto",
    "Open Sans",
    "Lato",
    "Montserrat",
    "Poppins",
    "Nunito",
    "Nunito Sans",
    "Raleway",
    "Work Sans",
    "DM Sans",
    "Manrope",
    "Plus Jakarta Sans",
    "Outfit",
    "Sora",
    "Space Grotesk",
    "Figtree",
    "Onest",
    "Urbanist",
    "Lexend",
    "Rubik",
    "Karla",
    "Mulish",
    "Source Sans 3",
    "IBM Plex Sans",
    "Noto Sans",
    "PT Sans",
    "Barlow",
    "Barlow Condensed",
    "Archivo",
    "Archivo Narrow",
    "Albert Sans",
    "Be Vietnam Pro",
    "Red Hat Display",
    "Red Hat Text",
    "Public Sans",
    "Hanken Grotesk",
    "Schibsted Grotesk",
    "Instrument Sans",
    "Geologica",
    "Epilogue",
    "Kanit",
    "Heebo",
    "Assistant",
    "Cabin",
    "Quicksand",
    "Josefin Sans",
    "Oswald",
    "Exo 2",
    "Titillium Web",
    "Mukta",
    "Hind",
    "Asap",
    "Overpass",
    "Chivo",
    "Jost",
    "Readex Pro",
    "Syne",
    "Golos Text",
    "Bricolage Grotesque",
    "Wix Madefor Display",
    "Afacad",
    "Gantari",
    "Geist",
  ]),
  ...f("serif", [
    "Playfair Display",
    "Merriweather",
    "Lora",
    "EB Garamond",
    "Cormorant Garamond",
    "Libre Baskerville",
    "Crimson Pro",
    "Source Serif 4",
    "PT Serif",
    "Noto Serif",
    "IBM Plex Serif",
    "DM Serif Display",
    "DM Serif Text",
    "Fraunces",
    "Newsreader",
    "Instrument Serif",
    "Spectral",
    "Bitter",
    "Zilla Slab",
    "Roboto Slab",
    "Arvo",
    "Libre Caslon Text",
    "Cardo",
    "Old Standard TT",
    "Prata",
    "Young Serif",
    "Gloock",
    "Bodoni Moda",
    "Literata",
    "Petrona",
    "Brygada 1918",
    "Alegreya",
    "Vollkorn",
    "Cormorant",
    "Marcellus",
    "Gelasio",
    "Rufina",
    "Besley",
  ]),
  ...f("display", [
    "Bebas Neue",
    "Anton",
    "Archivo Black",
    "Alfa Slab One",
    "Abril Fatface",
    "Righteous",
    "Bungee",
    "Black Ops One",
    "Russo One",
    "Staatliches",
    "Unbounded",
    "Dela Gothic One",
    "Monoton",
    "Rubik Mono One",
    "Big Shoulders Display",
    "Fjalla One",
    "Teko",
    "Passion One",
    "Lilita One",
    "Luckiest Guy",
    "Titan One",
    "Chango",
    "Bowlby One",
    "Ultra",
    "Syncopate",
    "Michroma",
    "Orbitron",
    "Audiowide",
    "Krona One",
    "Climate Crisis",
    "Rammetto One",
    "Shrikhand",
    "Tilt Warp",
    "Gasoek One",
    "Bagel Fat One",
    "Instrument Serif",
  ]),
  ...f("mono", [
    "JetBrains Mono",
    "Fira Code",
    "IBM Plex Mono",
    "Space Mono",
    "Roboto Mono",
    "DM Mono",
    "Source Code Pro",
    "Inconsolata",
    "Ubuntu Mono",
    "Martian Mono",
    "Geist Mono",
  ]),
  ...f("handwriting", [
    "Caveat",
    "Pacifico",
    "Dancing Script",
    "Satisfy",
    "Great Vibes",
    "Kalam",
    "Patrick Hand",
    "Shadows Into Light",
    "Permanent Marker",
    "Amatic SC",
    "Indie Flower",
    "Sacramento",
    "Homemade Apple",
    "Reenie Beanie",
    "Gochi Hand",
    "Nothing You Could Do",
    "Yellowtail",
    "Allura",
    "Parisienne",
    "Covered By Your Grace",
  ]),
].filter((font, i, all) => all.findIndex((x) => x.family === font.family) === i);

const BY_KEY = new Map(FONT_CATALOG.map((font) => [fontKey(font.family), font]));

export function fontKey(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function catalogFont(family: string | null | undefined): CatalogFont | null {
  if (!family) return null;
  return BY_KEY.get(fontKey(family)) ?? null;
}

export const CATEGORY_FALLBACK: Record<FontCategory, string> = {
  sans: "ui-sans-serif, system-ui, sans-serif",
  serif: "ui-serif, Georgia, serif",
  display: "ui-sans-serif, system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, monospace",
  handwriting: "cursive",
};

/** CSS font-family value with a sensible fallback stack. */
export function fontStack(family: string | null | undefined, category?: FontCategory): string {
  if (!family) return CATEGORY_FALLBACK.sans;
  const cat = category ?? catalogFont(family)?.category ?? guessCategory(family);
  return `'${family.replace(/'/g, "")}', ${CATEGORY_FALLBACK[cat]}`;
}

export function guessCategory(text: string): FontCategory {
  const t = text.toLowerCase();
  if (/mono|code|typewriter/.test(t)) return "mono";
  if (/script|hand|brush|marker|cursive|calligraph/.test(t)) return "handwriting";
  if (
    /serif|garamond|didone|bodoni|slab|roman|times|georgia|baskerville/.test(t) &&
    !/sans/.test(t)
  )
    return "serif";
  if (/display|condensed|poster|heavy|black|stencil|retro|impact/.test(t)) return "display";
  return "sans";
}

/** Default suggestion per category when a guess can't be matched. */
const CATEGORY_DEFAULT: Record<FontCategory, string> = {
  sans: "Inter",
  serif: "Playfair Display",
  display: "Bebas Neue",
  mono: "JetBrains Mono",
  handwriting: "Caveat",
};

/**
 * Map a model's font guess ("a geometric sans like Futura", "Helvetica Neue
 * Bold", "Garamond") to a real catalogue family.
 */
export function nearestCatalogFont(guess: string | null | undefined): CatalogFont {
  const text = (guess ?? "").trim();
  if (!text) return { family: CATEGORY_DEFAULT.sans, category: "sans" };
  const exact = catalogFont(text);
  if (exact) return exact;
  // A catalogue family named inside the guess, longest name first.
  const key = fontKey(text);
  const named = [...FONT_CATALOG]
    .sort((a, b) => b.family.length - a.family.length)
    .find((font) => key.includes(fontKey(font.family)));
  if (named) return named;
  // Well-known commercial faces → closest free family.
  const LOOKALIKE: Array<[RegExp, string]> = [
    [/helvetica|arial|neue haas|san francisco|sf pro/i, "Inter"],
    [/futura|avenir|century gothic|gotham|circular|product sans|google sans/i, "Outfit"],
    [/proxima|brandon|museo sans/i, "Montserrat"],
    [/garamond|caslon|minion/i, "EB Garamond"],
    [/didot|bodoni|vogue/i, "Bodoni Moda"],
    [/times|georgia|tiempos/i, "Newsreader"],
    [/impact|league gothic|knockout|druk/i, "Anton"],
    [/din|eurostile/i, "Barlow"],
    [/courier|consolas|menlo/i, "IBM Plex Mono"],
    [/brush|signature/i, "Satisfy"],
  ];
  const look = LOOKALIKE.find(([re]) => re.test(text));
  if (look) return catalogFont(look[1])!;
  const category = guessCategory(text);
  return { family: CATEGORY_DEFAULT[category], category };
}

const WEIGHTS = "400;500;600;700;800";

/** Google Fonts CSS2 URL for the given families (catalogue families only). */
export function googleFontHref(families: Array<string | null | undefined>): string | null {
  const known = [
    ...new Set(families.map((x) => catalogFont(x)?.family).filter(Boolean) as string[]),
  ];
  if (!known.length) return null;
  const params = known
    .map((family) => {
      const fam = family.replace(/ /g, "+");
      const cat = catalogFont(family)?.category;
      // Script and some display faces ship one weight; ask for regular only.
      return cat === "handwriting" || cat === "display"
        ? `family=${fam}`
        : `family=${fam}:wght@${WEIGHTS}`;
    })
    .join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

const loadedLinks = new Set<string>();

/** Inject the Google Fonts stylesheet for these families once (browser only). */
export function ensureGoogleFonts(families: Array<string | null | undefined>): void {
  if (typeof document === "undefined") return;
  const missing = families.filter((x) => {
    const fam = catalogFont(x)?.family;
    return fam && !loadedLinks.has(fam);
  });
  const href = googleFontHref(missing);
  if (!href) return;
  missing.forEach((x) => loadedLinks.add(catalogFont(x)!.family));
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.melloxFonts = "1";
  document.head.appendChild(link);
}

const loadedFaces = new Map<string, Promise<boolean>>();

/** Register an uploaded font file under `family` (browser only). */
export function loadFontFile(family: string, url: string): Promise<boolean> {
  if (typeof document === "undefined" || typeof FontFace === "undefined")
    return Promise.resolve(false);
  const key = `${family}|${url}`;
  const hit = loadedFaces.get(key);
  if (hit) return hit;
  const p = new FontFace(family, `url(${JSON.stringify(url)})`)
    .load()
    .then((face) => {
      document.fonts.add(face);
      return true;
    })
    .catch(() => false);
  loadedFaces.set(key, p);
  return p;
}

/** Ensure a family is ready to draw on a canvas (waits for the load). */
export async function fontReady(family: string | null | undefined, weight = 700): Promise<boolean> {
  if (!family || typeof document === "undefined" || !document.fonts) return false;
  ensureGoogleFonts([family]);
  try {
    const faces = await document.fonts.load(`${weight} 32px '${family.replace(/'/g, "")}'`);
    return faces.length > 0;
  } catch {
    return false;
  }
}
