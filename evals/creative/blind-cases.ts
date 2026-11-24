// Frozen cases for the Round 9 blind benchmark (ADR-0053,
// tests/live/creative-blind.live.ts). Version the list; never edit a case in
// place (add a new id), so rounds stay comparable.
//
// 50 single-picture cases from cases.ts (image, sales, educational) plus 24
// service-business cases (the businesses Studio served worst), four brands
// with six posts each for the within-brand uniqueness check, and a few
// A-vs-A controls that measure the judge's noise.
import { BRANDS, CASES, type BenchBrand, type BenchCase } from "./cases";

export const BLIND_VERSION = 1;

const svc = (
  id: string,
  name: string,
  industry: string,
  audience: string,
  positioning: string,
  pains: string,
  objections: string,
  products: string[],
  colours: string,
): BenchBrand => ({
  id,
  name,
  industry,
  audience,
  website: `https://${id}.example.com`,
  language: "English",
  products,
  dna: [
    `Brand: ${name}`,
    `Industry: ${industry}`,
    `Positioning: ${positioning}`,
    "Voice: plain, confident, friendly",
    `Audience: ${audience}`,
    `Customer pain points: ${pains}`,
    `Customer objections: ${objections}`,
    `Products: ${products.join("; ")}`,
    `Colours: ${colours}`,
    "Writing language: English",
  ].join("\n"),
});

export const SERVICE_BRANDS: BenchBrand[] = [
  svc(
    "pixelforge",
    "Pixelforge",
    "Web development agency",
    "Founders and marketing leads at small and mid-size companies",
    "Fast, custom websites built in Next.js and Webflow, launched in four weeks",
    "slow template sites, missed launch dates, agencies that vanish after launch",
    "cost; whether they can edit the site themselves",
    ["Website redesign", "Shopify store build", "Monthly site care plan"],
    "ink #111318, signal green #3DDC84, white",
  ),
  svc(
    "nightowl",
    "Night Owl Games",
    "Game studio (indie PC and console games)",
    "Players 16-35 who love co-op and roguelike games",
    "A small studio making hand-crafted co-op roguelikes",
    "games that feel like reskins, launches full of bugs",
    "is it worth the price; will it get updates",
    ["Lanternfall (co-op roguelike)", "Lanternfall soundtrack"],
    "midnight #0B1026, ember orange #FF7A1A, bone #F2EBDD",
  ),
  svc(
    "northside",
    "Northside Plumbing",
    "Plumbing and heating",
    "Homeowners and landlords on the north side of the city",
    "Same-day plumbing and boiler repair with fixed prices agreed before work starts",
    "no-shows, surprise bills, mess left behind",
    "price; whether they will turn up on time",
    ["Boiler repair", "Leak and burst pipe call-out", "Annual boiler service"],
    "deep blue #12355B, safety yellow #FFC531, white",
  ),
  svc(
    "brightnest",
    "BrightNest Cleaning",
    "Cleaning services (home and office)",
    "Busy families and small offices",
    "Vetted, insured cleaners who bring their own eco supplies",
    "unreliable cleaners, strangers in the home, missed spots",
    "trust; price per visit",
    ["Weekly home clean", "End of tenancy deep clean", "Office cleaning"],
    "fresh teal #0E9F9A, soft lemon #FFF3B0, white",
  ),
];

const S = (
  id: string,
  brand: string,
  brief: string,
  goal: BenchCase["goal"],
  platform = "instagram",
): BenchCase => ({
  id,
  kind: "image",
  brand,
  brief,
  goal,
  platforms: [platform],
});

export const SERVICE_CASES: BenchCase[] = [
  S("svc-pf-1", "pixelforge", "Show a before and after of a client homepage we rebuilt", "leads"),
  S(
    "svc-pf-2",
    "pixelforge",
    "We launch sites in four weeks: how our process works",
    "awareness",
    "linkedin",
  ),
  S(
    "svc-pf-3",
    "pixelforge",
    "Our monthly site care plan: updates, backups and fixes handled",
    "offer",
  ),
  S(
    "svc-pf-4",
    "pixelforge",
    "Is your website losing you leads? Book a free 20-minute audit",
    "leads",
    "linkedin",
  ),
  S("svc-pf-5", "pixelforge", "Meet the team that builds your site", "awareness"),
  S(
    "svc-pf-6",
    "pixelforge",
    "We are hiring a senior frontend developer, remote",
    "awareness",
    "linkedin",
  ),
  S("svc-no-1", "nightowl", "Lanternfall leaves early access on Friday", "launch"),
  S("svc-no-2", "nightowl", "Patch 1.3: new biome, two new bosses and co-op fixes", "engagement"),
  S("svc-no-3", "nightowl", "Bring a friend: Lanternfall is better in co-op", "awareness"),
  S("svc-no-4", "nightowl", "Behind the scenes: how we design a boss fight", "engagement"),
  S("svc-no-5", "nightowl", "The Lanternfall soundtrack is out now", "launch"),
  S("svc-no-6", "nightowl", "Weekend sale on Lanternfall", "offer"),
  S("svc-ns-1", "northside", "Same-day boiler repair across the north side", "leads"),
  S("svc-ns-2", "northside", "Book your annual boiler service before winter", "offer"),
  S("svc-ns-3", "northside", "What to do in the first five minutes of a burst pipe", "education"),
  S("svc-ns-4", "northside", "Fixed price agreed before we start, no surprise bills", "awareness"),
  S("svc-ns-5", "northside", "We are hiring a qualified gas engineer", "awareness", "facebook"),
  S("svc-ns-6", "northside", "Three signs your boiler needs a check", "education"),
  S("svc-bn-1", "brightnest", "End of tenancy deep clean so you get your deposit back", "offer"),
  S("svc-bn-2", "brightnest", "Our cleaners are vetted and insured", "awareness"),
  S("svc-bn-3", "brightnest", "Weekly home clean: come home to a fresh house", "leads"),
  S("svc-bn-4", "brightnest", "We bring our own eco supplies", "awareness"),
  S(
    "svc-bn-5",
    "brightnest",
    "Office cleaning for small teams, before or after hours",
    "leads",
    "linkedin",
  ),
  S("svc-bn-6", "brightnest", "Five spots most cleans miss", "education"),
];

/** Every blind case: the single-picture bench cases plus the service set. */
export const BLIND_CASES: BenchCase[] = [
  ...CASES.filter((c) => c.kind === "image" || c.kind === "sales" || c.kind === "educational"),
  ...SERVICE_CASES,
];

/** A-vs-A controls: the same arm twice, to measure how noisy the judge is. */
export const CONTROL_IDS: readonly string[] = ["svc-pf-1", "svc-ns-1", "svc-no-1", "svc-bn-3"];

export function blindBrand(id: string): BenchBrand {
  const brand = [...BRANDS, ...SERVICE_BRANDS].find((b) => b.id === id);
  if (!brand) throw new Error(`unknown blind brand ${id}`);
  return brand;
}
