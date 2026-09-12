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
 * Moments whose content window is open now: the date is ahead of `today` and
 * within its lead time (plus `extraDays` of planning headroom).
 */
export function upcomingMoments(
  today: Date = new Date(),
  opts: { extraDays?: number; limit?: number; tags?: MomentTag[] } = {},
): MarketingMoment[] {
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const extra = opts.extraDays ?? 14;
  const out: MarketingMoment[] = [];
  for (const def of definitions()) {
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

export function daysUntil(date: string, today: Date = new Date()): number {
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.parse(`${date}T00:00:00Z`) - start) / 86_400_000);
}
