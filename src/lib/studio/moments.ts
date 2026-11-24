// Marketing moments — a deterministic calendar of dates worth planning content
// around. Suggestions use it so Mellox proposes timely work ahead of the date
// instead of on it. Movable feasts are tabled per year (no astronomy here).

export type MomentTag = "retail" | "b2b" | "community" | "culture" | "planning" | "global";

export type MarketingMoment = {
  id: string;
  name: string;
  /** ISO date (YYYY-MM-DD) the moment falls on. */
  date: string;
  /** Days ahead content should start going out. */
  leadDays: number;
  tags: MomentTag[];
  /** One line on why it matters for marketing. */
  angle: string;
};

type Def = Omit<MarketingMoment, "date" | "id"> & { key: string; dates: Record<number, string> };

/** Nth weekday of a month (weekday 0 = Sunday). n = -1 → last. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return iso(new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7)));
  }
  const last = new Date(Date.UTC(year, month + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return iso(new Date(Date.UTC(year, month + 1, -offset)));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fixed(month: number, day: number, years: number[]): Record<number, string> {
  return Object.fromEntries(years.map((y) => [y, iso(new Date(Date.UTC(y, month - 1, day)))]));
}

const YEARS = [2026, 2027, 2028];

function definitions(): Def[] {
  const thanksgiving = (y: number) => nthWeekday(y, 10, 4, 4);
  const plusDays = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return iso(d);
  };
  const perYear = (fn: (y: number) => string) => Object.fromEntries(YEARS.map((y) => [y, fn(y)]));

  return [
    {
      key: "new-year",
      name: "New Year",
      dates: fixed(1, 1, YEARS),
      leadDays: 21,
      tags: ["global", "planning"],
      angle: "Fresh starts, goals, and what changes this year.",
    },
    {
      key: "valentines",
      name: "Valentine's Day",
      dates: fixed(2, 14, YEARS),
      leadDays: 14,
      tags: ["retail", "culture"],
      angle: "Appreciation — for customers, partners, or the craft itself.",
    },
    {
      key: "iwd",
      name: "International Women's Day",
      dates: fixed(3, 8, YEARS),
      leadDays: 10,
      tags: ["community", "culture"],
      angle: "Real stories and substance, not a logo swap.",
    },
    {
      key: "ramadan",
      name: "Ramadan begins",
      dates: { 2026: "2026-02-18", 2027: "2027-02-08", 2028: "2028-01-28" },
      leadDays: 14,
      tags: ["community", "culture"],
      angle: "Respectful, useful content around changing routines.",
    },
    {
      key: "eid-al-fitr",
      name: "Eid al-Fitr",
      dates: { 2026: "2026-03-20", 2027: "2027-03-10", 2028: "2028-02-27" },
      leadDays: 10,
      tags: ["community", "retail"],
      angle: "Celebration, gifting, and gratitude.",
    },
    {
      key: "easter",
      name: "Easter",
      dates: { 2026: "2026-04-05", 2027: "2027-03-28", 2028: "2028-04-16" },
      leadDays: 14,
      tags: ["retail", "culture"],
      angle: "Seasonal offers and spring renewal.",
    },
    {
      key: "earth-day",
      name: "Earth Day",
      dates: fixed(4, 22, YEARS),
      leadDays: 10,
      tags: ["community", "global"],
      angle: "Concrete sustainability actions — proof over promises.",
    },
    {
      key: "eid-al-adha",
      name: "Eid al-Adha",
      dates: { 2026: "2026-05-27", 2027: "2027-05-16", 2028: "2028-05-05" },
      leadDays: 10,
      tags: ["community", "culture"],
      angle: "Generosity and community.",
    },
    {
      key: "mothers-day",
      name: "Mother's Day (US/CA)",
      dates: perYear((y) => nthWeekday(y, 4, 0, 2)),
      leadDays: 18,
      tags: ["retail", "culture"],
      angle: "Gifting guides and thank-you stories.",
    },
    {
      key: "fathers-day",
      name: "Father's Day (US/UK)",
      dates: perYear((y) => nthWeekday(y, 5, 0, 3)),
      leadDays: 18,
      tags: ["retail", "culture"],
      angle: "Gifting and role-model stories.",
    },
    {
      key: "mid-year",
      name: "Mid-year review",
      dates: fixed(6, 30, YEARS),
      leadDays: 14,
      tags: ["b2b", "planning"],
      angle: "H1 lessons and what to double down on for H2.",
    },
    {
      key: "back-to-school",
      name: "Back to school",
      dates: fixed(8, 20, YEARS),
      leadDays: 25,
      tags: ["retail", "planning"],
      angle: "Routines reset — practical checklists and offers.",
    },
    {
      key: "q4-planning",
      name: "Q4 planning season",
      dates: fixed(9, 15, YEARS),
      leadDays: 14,
      tags: ["b2b", "planning"],
      angle: "Year-end goals, budgets, and last-chance wins.",
    },
    {
      key: "halloween",
      name: "Halloween",
      dates: fixed(10, 31, YEARS),
      leadDays: 14,
      tags: ["retail", "culture"],
      angle: "Playful, on-brand seasonal creative.",
    },
    {
      key: "diwali",
      name: "Diwali",
      dates: { 2026: "2026-11-08", 2027: "2027-10-29", 2028: "2028-10-17" },
      leadDays: 14,
      tags: ["community", "retail"],
      angle: "Light, prosperity, and gifting.",
    },
    {
      key: "black-friday",
      name: "Black Friday",
      dates: perYear((y) => plusDays(thanksgiving(y), 1)),
      leadDays: 28,
      tags: ["retail"],
      angle: "Offers people plan for — announce early, make terms clear.",
    },
    {
      key: "small-business-saturday",
      name: "Small Business Saturday",
      dates: perYear((y) => plusDays(thanksgiving(y), 2)),
      leadDays: 14,
      tags: ["community", "retail"],
      angle: "Local pride and the people behind the business.",
    },
    {
      key: "cyber-monday",
      name: "Cyber Monday",
      dates: perYear((y) => plusDays(thanksgiving(y), 4)),
      leadDays: 21,
      tags: ["retail"],
      angle: "Online-only offers and last-chance urgency.",
    },
    {
      key: "giving-tuesday",
      name: "Giving Tuesday",
      dates: perYear((y) => plusDays(thanksgiving(y), 5)),
      leadDays: 14,
      tags: ["community"],
      angle: "Causes you support and how customers can help.",
    },
    {
      key: "holidays",
      name: "Holiday season",
      dates: fixed(12, 20, YEARS),
      leadDays: 25,
      tags: ["retail", "global"],
      angle: "Gift guides, shipping cut-offs, and year-end thanks.",
    },
    {
      key: "year-in-review",
      name: "Year in review",
      dates: fixed(12, 30, YEARS),
      leadDays: 14,
      tags: ["b2b", "planning"],
      angle: "What you learned, shipped, and what's next.",
    },
    ...YEARS.flatMap((y) =>
      [3, 6, 9, 12].map((m) => ({
        key: `quarter-end-${m}`,
        name: `Q${m / 3} close`,
        dates: { [y]: iso(new Date(Date.UTC(y, m, 0))) },
        leadDays: 10,
        tags: ["b2b", "planning"] as MomentTag[],
        angle: "Urgency for decisions buyers want to land this quarter.",
      })),
    ),
  ];
}

/**
 * Round 9 (flag `culture`): a country's own dates. Only used when the brand's
 * country is known (countryOf); fixed national days and dates computed from
 * Easter or a weekday rule. Lunar festivals not already tabled above are left
 * out rather than guessed.
 */
function countryDefinitions(): (Def & { countries: string[] })[] {
  const perYear = (fn: (y: number) => string) => Object.fromEntries(YEARS.map((y) => [y, fn(y)]));
  const day = (
    country: string | string[],
    key: string,
    name: string,
    m: number,
    d: number,
    angle: string,
    tags: MomentTag[] = ["culture", "community"],
    leadDays = 10,
  ) => ({
    key,
    name,
    dates: fixed(m, d, YEARS),
    leadDays,
    tags,
    angle,
    countries: Array.isArray(country) ? country : [country],
  });
  const easter: Record<number, string> = {
    2026: "2026-04-05",
    2027: "2027-03-28",
    2028: "2028-04-16",
  };
  const fromEaster = (days: number) =>
    Object.fromEntries(
      YEARS.map((y) => {
        const d = new Date(`${easter[y]}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return [y, iso(d)];
      }),
    );
  const NATIONAL =
    "Pride in the place you serve: your own people, customers and the community, never a flag pasted on an ad.";
  return [
    // South Asia
    day("PK", "pk-pakistan-day", "Pakistan Day", 3, 23, NATIONAL),
    day(
      "PK",
      "pk-independence",
      "Independence Day (Pakistan)",
      8,
      14,
      NATIONAL,
      ["culture", "community", "retail"],
      14,
    ),
    day(
      "PK",
      "pk-iqbal-day",
      "Iqbal Day",
      11,
      9,
      "Ideas and learning; a line of poetry only if the brand's voice fits it.",
    ),
    day("PK", "pk-quaid-day", "Quaid-e-Azam Day", 12, 25, NATIONAL),
    day(
      "IN",
      "in-republic-day",
      "Republic Day (India)",
      1,
      26,
      NATIONAL,
      ["culture", "community", "retail"],
      12,
    ),
    day(
      "IN",
      "in-independence",
      "Independence Day (India)",
      8,
      15,
      NATIONAL,
      ["culture", "community", "retail"],
      14,
    ),
    day(
      "IN",
      "in-gandhi-jayanti",
      "Gandhi Jayanti",
      10,
      2,
      "Service, simplicity and doing the right thing; never a sale.",
    ),
    // Gulf
    day(
      "AE",
      "ae-national-day",
      "UAE National Day",
      12,
      2,
      NATIONAL,
      ["culture", "community", "retail"],
      14,
    ),
    day(
      "SA",
      "sa-founding-day",
      "Saudi Founding Day",
      2,
      22,
      NATIONAL,
      ["culture", "community", "retail"],
      12,
    ),
    day(
      "SA",
      "sa-national-day",
      "Saudi National Day",
      9,
      23,
      NATIONAL,
      ["culture", "community", "retail"],
      14,
    ),
    day(
      "QA",
      "qa-national-day",
      "Qatar National Day",
      12,
      18,
      NATIONAL,
      ["culture", "community", "retail"],
      12,
    ),
    // Europe
    {
      key: "gb-mothering-sunday",
      name: "Mothering Sunday (UK)",
      dates: fromEaster(-21),
      leadDays: 14,
      tags: ["retail", "culture"],
      angle: "Thank-yous and gifts for mums; book early for anything made to order.",
      countries: ["GB", "IE"],
    },
    day(
      "GB",
      "gb-bonfire-night",
      "Bonfire Night",
      11,
      5,
      "Cosy autumn evenings and local events.",
      ["culture", "community"],
      7,
    ),
    day(
      ["GB", "AU", "CA", "NZ"],
      "boxing-day",
      "Boxing Day",
      12,
      26,
      "Post-Christmas offers people already expect; clear terms.",
      ["retail"],
      10,
    ),
    day("FR", "fr-bastille-day", "Fête nationale (14 juillet)", 7, 14, NATIONAL),
    day("DE", "de-unity-day", "Tag der Deutschen Einheit", 10, 3, NATIONAL),
    // Americas
    day(
      "US",
      "us-independence",
      "Independence Day (US)",
      7,
      4,
      NATIONAL,
      ["culture", "community", "retail"],
      14,
    ),
    {
      key: "us-memorial-day",
      name: "Memorial Day (US)",
      dates: perYear((y) => nthWeekday(y, 4, 1, -1)),
      leadDays: 10,
      tags: ["retail"],
      angle: "Long-weekend offers; remembrance stays respectful.",
      countries: ["US"],
    },
    {
      key: "us-labor-day",
      name: "Labor Day (US)",
      dates: perYear((y) => nthWeekday(y, 8, 1, 1)),
      leadDays: 10,
      tags: ["retail"],
      angle: "End of summer and long-weekend plans.",
      countries: ["US"],
    },
    day(
      "CA",
      "ca-canada-day",
      "Canada Day",
      7,
      1,
      NATIONAL,
      ["culture", "community", "retail"],
      12,
    ),
    {
      key: "ca-thanksgiving",
      name: "Thanksgiving (Canada)",
      dates: perYear((y) => nthWeekday(y, 9, 1, 2)),
      leadDays: 12,
      tags: ["culture", "community"],
      angle: "Gratitude for customers and the people behind the business.",
      countries: ["CA"],
    },
    day(
      "MX",
      "mx-independence",
      "Día de la Independencia",
      9,
      16,
      NATIONAL,
      ["culture", "community", "retail"],
      12,
    ),
    day(
      "MX",
      "mx-dia-de-muertos",
      "Día de Muertos",
      11,
      1,
      "Memory and family, told with care; never a costume or a joke about it.",
      ["culture"],
      14,
    ),
    day(
      "BR",
      "br-dia-dos-namorados",
      "Dia dos Namorados",
      6,
      12,
      "Couples and gifting: Brazil's Valentine's Day.",
      ["retail", "culture"],
      14,
    ),
    {
      key: "br-carnaval",
      name: "Carnaval",
      dates: fromEaster(-47),
      leadDays: 14,
      tags: ["culture", "retail"],
      angle: "Energy, colour and the long weekend; opening hours people need to know.",
      countries: ["BR"],
    },
    // Africa
    day("NG", "ng-independence", "Independence Day (Nigeria)", 10, 1, NATIONAL),
    day("ZA", "za-freedom-day", "Freedom Day", 4, 27, NATIONAL),
    day(
      "ZA",
      "za-heritage-day",
      "Heritage Day",
      9,
      24,
      "Shared heritage and the local braai; real people, never stereotypes.",
    ),
    // Asia-Pacific
    {
      key: "lunar-new-year",
      name: "Lunar New Year",
      dates: { 2026: "2026-02-17", 2027: "2027-02-06", 2028: "2028-01-26" },
      leadDays: 21,
      tags: ["culture", "retail"],
      angle: "Reunions, red envelopes and gifting; book and ship early.",
      countries: ["CN", "SG", "MY", "VN", "KR", "HK", "TW"],
    },
    day(
      ["CN", "SG", "MY"],
      "singles-day",
      "Singles' Day (11.11)",
      11,
      11,
      "The biggest online sale of the year here: plan offers and stock early.",
      ["retail"],
      21,
    ),
    day("ID", "id-independence", "Hari Kemerdekaan", 8, 17, NATIONAL),
    day("PH", "ph-independence", "Independence Day (Philippines)", 6, 12, NATIONAL),
    day(
      "AU",
      "au-eofy",
      "End of financial year (Australia)",
      6,
      30,
      "EOFY sales and planning for the year ahead.",
      ["retail", "b2b"],
      21,
    ),
  ];
}

/** Existing dates that belong to some markets only; ignored when the country isn't known. */
const HOME_MARKETS: Record<string, string[]> = {
  "mothers-day": ["US", "CA", "AU", "NZ", "IN", "PK", "ZA", "BR", "DE", "JP", "PH", "SG", "MY"],
  "fathers-day": ["US", "GB", "CA", "IN", "PK", "ZA", "IE", "PH", "SG", "MY", "FR"],
  halloween: ["US", "CA", "GB", "IE", "AU", "NZ"],
  "small-business-saturday": ["US", "GB"],
  "back-to-school": ["US", "CA", "GB", "IE", "DE", "FR"],
};

/** The definitions for a country (the old global list when none is known). */
function definitionsFor(country?: string | null): Def[] {
  const base = definitions();
  if (!country) return base;
  const c = country.toUpperCase();
  return [
    ...base.filter((d) => !HOME_MARKETS[d.key] || HOME_MARKETS[d.key].includes(c)),
    ...countryDefinitions().filter((d) => d.countries.includes(c)),
  ];
}

/** Every country the calendar has its own dates for (ISO 3166-1 alpha-2). */
export function calendarCountries(): string[] {
  return [...new Set(countryDefinitions().flatMap((d) => d.countries))].sort();
}

/**
 * Moments whose content window is open now: the date is ahead of `today` and
 * within its lead time (plus `extraDays` of planning headroom).
 */
export function upcomingMoments(
  today: Date = new Date(),
  opts: { extraDays?: number; limit?: number; tags?: MomentTag[]; country?: string | null } = {},
): MarketingMoment[] {
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const extra = opts.extraDays ?? 14;
  const out: MarketingMoment[] = [];
  for (const def of definitionsFor(opts.country)) {
    for (const date of Object.values(def.dates)) {
      const t = Date.parse(`${date}T00:00:00Z`);
      const daysAway = Math.round((t - start) / 86_400_000);
      if (daysAway < 0 || daysAway > def.leadDays + extra) continue;
      if (opts.tags?.length && !def.tags.some((tag) => opts.tags!.includes(tag))) continue;
      out.push({
        id: `${def.key}-${date.slice(0, 4)}`,
        name: def.name,
        date,
        leadDays: def.leadDays,
        tags: def.tags,
        angle: def.angle,
      });
    }
  }
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .slice(0, opts.limit ?? 6);
}

/** Every moment that falls on a day from `from` to `to` (inclusive, YYYY-MM-DD). */
export function momentsBetween(
  from: string,
  to: string,
  country?: string | null,
): MarketingMoment[] {
  const out = new Map<string, MarketingMoment>();
  for (const def of definitionsFor(country)) {
    for (const date of Object.values(def.dates)) {
      if (date < from || date > to) continue;
      const id = `${def.key}-${date.slice(0, 4)}`;
      if (!out.has(id)) {
        out.set(id, {
          id,
          name: def.name,
          date,
          leadDays: def.leadDays,
          tags: def.tags,
          angle: def.angle,
        });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function daysUntil(date: string, today: Date = new Date()): number {
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.parse(`${date}T00:00:00Z`) - start) / 86_400_000);
}

const TLD_COUNTRY: Record<string, string> = {
  pk: "PK",
  in: "IN",
  ae: "AE",
  sa: "SA",
  qa: "QA",
  uk: "GB",
  ie: "IE",
  fr: "FR",
  de: "DE",
  ca: "CA",
  mx: "MX",
  br: "BR",
  ng: "NG",
  za: "ZA",
  cn: "CN",
  sg: "SG",
  my: "MY",
  vn: "VN",
  kr: "KR",
  hk: "HK",
  tw: "TW",
  id: "ID",
  ph: "PH",
  au: "AU",
  nz: "NZ",
};
const LANGUAGE_COUNTRY: Record<string, string> = {
  urdu: "PK",
  "roman urdu": "PK",
  hindi: "IN",
  hinglish: "IN",
  "brazilian portuguese": "BR",
  german: "DE",
  french: "FR",
};

/**
 * The brand's country, from what Mellox already has (free): the website's
 * country domain (.pk, .co.uk, .com.au...), else a content language spoken
 * mostly in one country. Null when neither says; the calendar stays global.
 */
export function countryOf(args: {
  website?: string | null;
  language?: string | null;
}): string | null {
  const raw = (args.website ?? "").trim();
  if (raw) {
    try {
      const host = new URL(
        /^https?:\/\//i.test(raw) ? raw : `https://${raw}`,
      ).hostname.toLowerCase();
      const tld = host.split(".").pop() ?? "";
      if (TLD_COUNTRY[tld]) return TLD_COUNTRY[tld];
    } catch {
      // not a host; fall through to the language
    }
  }
  const lang = (args.language ?? "").trim().toLowerCase();
  return LANGUAGE_COUNTRY[lang] ?? null;
}
