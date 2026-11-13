// evals/creative/cases.ts — the Round 5 creative benchmark (100 cases).
//
// Fixture brands across industries and languages, and the pieces a real
// customer asks for. scripts/bench (tests/bench/creative-prompts.bench.ts)
// runs every case through the real prompt builders, with no network call, so
// the before/after comparison costs nothing. Brands are invented.

export type BenchBrand = {
  id: string;
  name: string;
  industry: string;
  audience: string;
  website: string;
  language: "English" | "Urdu" | "Roman Urdu";
  /** Brand DNA as the generators see it (serializeBrandContext-like). */
  dna: string;
  products: string[];
};

export type BenchKind =
  "image" | "sales" | "meme" | "carousel" | "educational" | "ugc" | "video" | "campaign";

export type BenchCase = {
  id: string;
  kind: BenchKind;
  brand: string;
  brief: string;
  category?: string;
  goal?: "awareness" | "engagement" | "leads" | "launch" | "education" | "offer";
  adObjective?: string;
  platforms: string[];
  /** Campaign cases: the playbook. Video cases: the kind. */
  playbook?: string;
  videoKind?: string;
};

const b = (
  id: string,
  name: string,
  industry: string,
  audience: string,
  language: BenchBrand["language"],
  voice: string,
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
  language,
  products,
  dna: [
    `Brand: ${name}`,
    `Industry: ${industry}`,
    `Positioning: ${positioning}`,
    `Voice: ${voice}`,
    `Audience: ${audience}`,
    `Customer pain points: ${pains}`,
    `Customer objections: ${objections}`,
    `Products: ${products.join("; ")}`,
    `Colours: ${colours}`,
    `Writing language: ${language}`,
  ].join("\n"),
});

export const BRANDS: BenchBrand[] = [
  b(
    "ledgerly",
    "Ledgerly",
    "SaaS (accounting software)",
    "Small-business owners and freelancers who do their own books",
    "English",
    "clear, calm, a little dry humour",
    "Bookkeeping that closes the month in ten minutes",
    "month-end panic, lost receipts, chasing invoices",
    "switching is painful; my accountant uses something else",
    ["Ledgerly Starter plan", "Receipt scanner app", "Auto invoice reminders"],
    "deep navy #10213F, mint #4FD1A5, white",
  ),
  b(
    "promptpilot",
    "PromptPilot",
    "AI tools (B2B)",
    "Marketing teams at 20-200 person companies",
    "English",
    "sharp, confident, practical",
    "AI agents that draft campaign briefs from your own data",
    "slow briefs, scattered data, generic AI output",
    "AI output is generic; data security",
    ["PromptPilot Teams", "Brief Agent"],
    "black, electric violet #6B4CFF, off-white",
  ),
  b(
    "noorthreads",
    "Noor Threads",
    "Fashion (eastern wear)",
    "Women 22-40 in Lahore and Karachi shopping for Eid and weddings",
    "Roman Urdu",
    "warm, elegant, festive",
    "Hand-finished lawn and chiffon at prêt prices",
    "outfits that look different from the photo, late delivery before Eid",
    "fabric quality online; sizing",
    ["Eid Lawn 3-piece", "Chiffon formal", "Kids' kurta"],
    "ivory, emerald #0F6B4F, gold accents",
  ),
  b(
    "velvetbare",
    "Velvet Bare",
    "Beauty (skincare)",
    "Women 25-40 with sensitive skin",
    "English",
    "gentle, science-backed, honest",
    "Fragrance-free skincare tested on sensitive skin",
    "redness, breakouts from new products, confusing ingredient lists",
    "will it irritate me; is it worth the price",
    ["Barrier Repair Serum", "Calm Cleanser", "SPF 50 fluid"],
    "blush #F3D9D3, clay, warm grey",
  ),
  b(
    "karachigrill",
    "Karachi Grill House",
    "Restaurant (BBQ)",
    "Families and friend groups in Karachi, weekend diners",
    "Urdu",
    "loud, hospitable, proud of the food",
    "Charcoal BBQ since 1998, the Burns Road taste in DHA",
    "crowded places, inconsistent taste, long waits",
    "parking; is it hygienic",
    ["Seekh kebab platter", "Family BBQ deal", "Malai boti"],
    "charcoal black, ember orange #E8591A, cream",
  ),
  b(
    "brewline",
    "Brewline Coffee",
    "Café / coffee shop",
    "Students and remote workers near the university",
    "English",
    "friendly, witty, cosy",
    "Slow-roasted coffee and a quiet place to work",
    "noisy cafés, bad Wi-Fi, burnt coffee",
    "price vs chain cafés",
    ["Oat flat white", "Study pass (5 coffees)", "Banana bread"],
    "espresso brown, oat #EFE6D8, sage",
  ),
  b(
    "keystone",
    "Keystone Homes",
    "Real estate",
    "First-time buyers and young families in the suburbs",
    "English",
    "trustworthy, plain-spoken",
    "Local agents who answer the phone on Sundays",
    "hidden fees, pushy agents, not knowing the area",
    "commission cost; can I afford it",
    ["Free home valuation", "First-buyer guide", "3-bed listings"],
    "forest green #1F4D3A, stone, white",
  ),
  b(
    "brightpath",
    "BrightPath Academy",
    "Education (online tutoring)",
    "Parents of O/A-level students in Pakistan",
    "Roman Urdu",
    "encouraging, structured, parent-friendly",
    "Small online classes with weekly progress reports",
    "falling grades, expensive tuition centres, no visibility for parents",
    "online classes don't work; teacher quality",
    ["O-level Maths batch", "A-level Physics", "Free trial class"],
    "royal blue #1E4FD8, sunshine yellow, white",
  ),
  b(
    "ironroots",
    "Iron Roots Gym",
    "Fitness",
    "Beginners 25-45 who feel intimidated by gyms",
    "English",
    "motivating, no-ego, inclusive",
    "Coached beginner strength classes, never judged",
    "gym anxiety, no plan, quitting after two weeks",
    "membership cost; not fit enough to start",
    ["Beginner 6-week program", "Personal training", "Free first session"],
    "black, safety orange #FF6A13, concrete grey",
  ),
  b(
    "carewell",
    "CareWell Clinic",
    "Healthcare (family clinic)",
    "Families in the neighbourhood needing a GP",
    "English",
    "caring, calm, reassuring",
    "Same-day GP appointments and online booking",
    "long waits, rushed doctors",
    "insurance accepted; wait times",
    ["Same-day GP visit", "Child vaccination", "Health check-up"],
    "teal #0E8C8C, soft white, light grey",
  ),
  b(
    "sahulat",
    "Sahulat Finance",
    "Finance (fintech app)",
    "Young salaried people managing money for the first time",
    "Urdu",
    "clear, respectful, empowering",
    "Halal savings goals in one app",
    "money runs out before month end, no savings habit",
    "is it safe; is it halal",
    ["Savings goals", "Bill reminders", "Committee (ROSCA) tracker"],
    "deep green #0B5D3B, white, gold",
  ),
  b(
    "lexbridge",
    "LexBridge Legal",
    "Professional services (law firm)",
    "Founders of small companies",
    "English",
    "precise, approachable",
    "Fixed-fee legal for startups",
    "surprise legal bills, contracts they don't understand",
    "lawyers are expensive; I'll use a template",
    ["Startup incorporation package", "Contract review", "Trademark filing"],
    "ink navy, burgundy #7A1F2B, paper white",
  ),
  b(
    "motorhaus",
    "Motorhaus Detailing",
    "Automotive (car detailing)",
    "Car enthusiasts and busy professionals",
    "English",
    "bold, meticulous",
    "Ceramic coating and showroom-level detailing",
    "swirl marks, dull paint, car washes that scratch",
    "price of ceramic coating; does it last",
    ["Ceramic coating 3-year", "Interior deep clean", "Monthly wash plan"],
    "gloss black, chrome, signal red #D7192A",
  ),
  b(
    "hunzatrails",
    "Hunza Trails",
    "Travel (tour operator)",
    "Young professionals and couples planning northern Pakistan trips",
    "Roman Urdu",
    "adventurous, warm, safety-first",
    "Small-group tours to Hunza and Skardu with local guides",
    "unsafe roads, bad hotels, planning stress",
    "price; safety; weather",
    ["5-day Hunza tour", "Skardu honeymoon package", "Fairy Meadows trek"],
    "glacier blue, apricot #F2A65A, stone",
  ),
  b(
    "thelinen",
    "The Linen Room",
    "Hospitality (boutique hotel)",
    "Couples and weekend travellers",
    "English",
    "quiet luxury, understated",
    "A 12-room hotel with a garden breakfast",
    "chain hotels that feel the same",
    "price per night; location",
    ["Weekend escape package", "Garden breakfast", "Anniversary suite"],
    "linen white, olive #6B7445, terracotta",
  ),
  b(
    "growthforge",
    "GrowthForge Agency",
    "Marketing agency",
    "E-commerce founders doing $20k-$500k a month",
    "English",
    "direct, data-minded, irreverent",
    "Paid social that pays back in 60 days",
    "ads that stopped working, agencies that report vanity metrics",
    "agency retainers; long contracts",
    ["Paid social management", "Creative testing sprint", "Free ad account audit"],
    "black, acid lime #C6FF3D, white",
  ),
  b(
    "petalpost",
    "Petal Post",
    "E-commerce (flower delivery)",
    "People sending gifts to someone they love, last minute",
    "English",
    "romantic, playful",
    "Same-day bouquets that look like the photo",
    "flowers that arrive wilted or look different",
    "delivery times; freshness",
    ["Signature roses bouquet", "Seasonal box", "Same-day delivery"],
    "petal pink #F7A8B8, deep green, cream",
  ),
  b(
    "chaiwala",
    "Chai Wala & Co",
    "Local business (tea stall chain)",
    "Office workers and students in Islamabad",
    "Roman Urdu",
    "desi, funny, nostalgic",
    "Doodh patti the way your nani made it",
    "bad office tea, overpriced coffee",
    "hygiene; is it worth it",
    ["Doodh patti", "Karak chai", "Bun kebab"],
    "chai brown, turmeric yellow #F2B705, white",
  ),
  b(
    "stacksecure",
    "StackSecure",
    "B2B services (cybersecurity)",
    "IT managers at mid-size companies",
    "English",
    "calm, expert, no fear-mongering",
    "Managed security for teams without a security department",
    "alert fatigue, compliance audits, ransomware worry",
    "cost; we already have antivirus",
    ["Managed detection", "Compliance readiness", "Free security check"],
    "midnight blue, cyan #19C2E6, white",
  ),
  b(
    "greenbasket",
    "GreenBasket",
    "E-commerce (organic grocery)",
    "Health-conscious families ordering weekly groceries",
    "English",
    "fresh, honest, homely",
    "Farm-fresh organic produce delivered weekly",
    "pesticides, wilted supermarket veg",
    "organic costs more; delivery slots",
    ["Weekly veg box", "Organic eggs", "Fruit basket"],
    "leaf green #3E9B3E, kraft brown, white",
  ),
];

type Spec = [brand: string, brief: string, extra?: Partial<BenchCase>];

const many = (
  kind: BenchKind,
  platforms: string[],
  specs: Spec[],
  base: Partial<BenchCase> = {},
): BenchCase[] =>
  specs.map(([brand, brief, extra], i) => ({
    id: `${kind}-${String(i + 1).padStart(2, "0")}`,
    kind,
    brand,
    brief,
    platforms,
    ...base,
    ...extra,
  }));

export const CASES: BenchCase[] = [
  ...many(
    "image",
    ["instagram"],
    [
      ["ledgerly", "A post about closing the month in ten minutes", { category: "product" }],
      [
        "promptpilot",
        "Show what Brief Agent does for a marketing team",
        { category: "product", platforms: ["linkedin"] },
      ],
      ["noorthreads", "New Eid lawn collection is live", { category: "launch" }],
      ["velvetbare", "Barrier Repair Serum hero post", { category: "product" }],
      ["karachigrill", "Weekend family BBQ night vibe", { category: "aesthetic" }],
      ["brewline", "Our new oat flat white", { category: "product" }],
      [
        "keystone",
        "We answer the phone on Sundays",
        { category: "proof", platforms: ["facebook"] },
      ],
      ["ironroots", "Behind the scenes of a beginner class", { category: "behind-scenes" }],
      [
        "carewell",
        "Same-day appointments are available",
        { category: "product", platforms: ["facebook"] },
      ],
      [
        "lexbridge",
        "Founder story: why we went fixed-fee",
        { category: "storytime", platforms: ["linkedin"] },
      ],
      ["motorhaus", "Ceramic coating before and after", { category: "before-after" }],
      ["hunzatrails", "Hunza in autumn, the trip of the year", { category: "aesthetic" }],
      ["thelinen", "Garden breakfast at The Linen Room", { category: "aesthetic" }],
      [
        "growthforge",
        "We report profit, not vanity metrics",
        { category: "quote", platforms: ["linkedin"] },
      ],
      ["petalpost", "Same-day bouquets that look like the photo", { category: "product" }],
      ["chaiwala", "Winter doodh patti season", { category: "local" }],
      [
        "stacksecure",
        "Announcing our compliance readiness service",
        { category: "launch", platforms: ["linkedin"] },
      ],
      ["greenbasket", "What's in this week's veg box", { category: "product" }],
      ["sahulat", "Start your first savings goal", { category: "tips" }],
      [
        "brightpath",
        "Customer testimonial from a parent",
        { category: "proof", platforms: ["facebook"] },
      ],
    ],
  ),
  ...many(
    "sales",
    ["instagram", "facebook"],
    [
      [
        "noorthreads",
        "Eid sale: 20% off all lawn 3-piece suits until 10 April",
        { category: "sale", goal: "offer", adObjective: "sales" },
      ],
      [
        "velvetbare",
        "Buy the serum and cleanser together, save 15%",
        { category: "sale", goal: "offer", adObjective: "sales" },
      ],
      [
        "karachigrill",
        "Family BBQ deal for 6 people, Rs 5,999",
        { category: "sale", goal: "offer", adObjective: "local" },
      ],
      [
        "brewline",
        "Study pass: 5 coffees for the price of 4",
        { category: "sale", goal: "offer", adObjective: "local" },
      ],
      [
        "ironroots",
        "Book your free first session",
        { category: "product", goal: "leads", adObjective: "leads" },
      ],
      [
        "keystone",
        "Get a free home valuation",
        { category: "product", goal: "leads", adObjective: "leads" },
      ],
      [
        "brightpath",
        "Book a free trial class for O-level Maths",
        { category: "product", goal: "leads", adObjective: "leads" },
      ],
      [
        "ledgerly",
        "Start a 14-day free trial",
        { category: "product", goal: "leads", adObjective: "app", platforms: ["linkedin"] },
      ],
      [
        "promptpilot",
        "Retarget visitors who saw the pricing page",
        { goal: "offer", adObjective: "retarget", platforms: ["linkedin"] },
      ],
      [
        "growthforge",
        "Free ad account audit for e-commerce brands",
        { goal: "leads", adObjective: "leads" },
      ],
      [
        "petalpost",
        "Valentine's same-day delivery, order by 2pm",
        { category: "sale", goal: "offer", adObjective: "sales" },
      ],
      [
        "motorhaus",
        "Ceramic coating package, book this month",
        { category: "product", goal: "offer", adObjective: "sales" },
      ],
      [
        "hunzatrails",
        "Early-bird price for the October Hunza tour",
        { category: "sale", goal: "offer", adObjective: "sales" },
      ],
      [
        "thelinen",
        "Weekend escape package for two",
        { category: "product", goal: "offer", adObjective: "sales" },
      ],
      [
        "carewell",
        "Flu vaccines now available, walk in",
        { category: "product", goal: "awareness", adObjective: "local" },
      ],
      [
        "sahulat",
        "Download the app and set your first goal",
        { goal: "leads", adObjective: "app" },
      ],
      [
        "stacksecure",
        "Free security check for IT teams",
        { goal: "leads", adObjective: "leads", platforms: ["linkedin"] },
      ],
      [
        "greenbasket",
        "First veg box half price",
        { category: "sale", goal: "offer", adObjective: "sales" },
      ],
      [
        "lexbridge",
        "Startup incorporation package, fixed fee",
        { category: "product", goal: "offer", adObjective: "traffic", platforms: ["linkedin"] },
      ],
      [
        "chaiwala",
        "Free bun kebab with every karak chai this Friday",
        { category: "sale", goal: "offer", adObjective: "local" },
      ],
    ],
  ),
  ...many(
    "meme",
    ["instagram"],
    [
      ["ledgerly", "A meme about month-end bookkeeping panic", { category: "meme" }],
      [
        "promptpilot",
        "A meme about generic AI copy",
        { category: "meme", platforms: ["linkedin"] },
      ],
      ["noorthreads", "A meme about the outfit hunt before Eid", { category: "meme" }],
      ["velvetbare", "A meme about trying a new skincare product", { category: "meme" }],
      ["karachigrill", "A meme about the BBQ craving at midnight", { category: "meme" }],
      ["brewline", "A meme about studying in a café", { category: "meme" }],
      ["ironroots", "A meme about the first day at the gym", { category: "meme" }],
      [
        "growthforge",
        "A meme about agency reports full of vanity metrics",
        { category: "meme", platforms: ["linkedin"] },
      ],
      ["chaiwala", "A meme about office tea", { category: "meme" }],
      ["brightpath", "A meme about parents asking about results day", { category: "meme" }],
      ["hunzatrails", "A meme about planning a northern trip with friends", { category: "meme" }],
      ["stacksecure", "A meme about alert fatigue", { category: "meme", platforms: ["linkedin"] }],
      ["petalpost", "A meme about forgetting an anniversary", { category: "meme" }],
      ["motorhaus", "A meme about automatic car washes", { category: "meme" }],
      ["sahulat", "A meme about salary gone by the 20th", { category: "meme" }],
    ],
  ),
  ...many(
    "carousel",
    ["instagram"],
    [
      ["ledgerly", "5 bookkeeping habits that save 4 hours a month", { category: "tips" }],
      [
        "promptpilot",
        "How a team cut brief time from 3 days to 1 hour",
        { category: "proof", platforms: ["linkedin"] },
      ],
      ["noorthreads", "How to style one lawn suit three ways for Eid", { category: "tips" }],
      ["velvetbare", "Myths about sensitive skin", { category: "myth" }],
      ["karachigrill", "The story of our 1998 seekh kebab recipe", { category: "storytime" }],
      ["keystone", "First-time buyer checklist", { category: "list", goal: "leads" }],
      [
        "brightpath",
        "How our weekly progress report works",
        { category: "product", goal: "leads" },
      ],
      ["ironroots", "Your first week of strength training", { category: "tips" }],
      [
        "growthforge",
        "Why your ads stopped working (and the fix)",
        { category: "myth", platforms: ["linkedin"], goal: "leads" },
      ],
      ["hunzatrails", "Hunza vs Skardu: which trip is for you", { category: "this-or-that" }],
      ["sahulat", "How a committee tracker works", { category: "tips" }],
      [
        "stacksecure",
        "Compliance audit prep in 6 steps",
        { category: "list", platforms: ["linkedin"] },
      ],
      [
        "greenbasket",
        "Organic vs supermarket: what you actually get",
        { category: "this-or-that" },
      ],
      [
        "lexbridge",
        "The founder's guide to a first contract",
        { category: "tips", platforms: ["linkedin"] },
      ],
      ["petalpost", "Sale: three bouquets under $40", { category: "sale", goal: "offer" }],
    ],
  ),
  ...many(
    "educational",
    ["instagram"],
    [
      [
        "ledgerly",
        "Explain cash vs accrual in one picture",
        { category: "tips", goal: "education" },
      ],
      ["velvetbare", "How to read an ingredient list", { category: "tips", goal: "education" }],
      [
        "carewell",
        "When to see a doctor for a fever",
        { category: "tips", goal: "education", platforms: ["facebook"] },
      ],
      ["sahulat", "The 50/30/20 budget rule", { category: "tips", goal: "education" }],
      [
        "stacksecure",
        "How to spot a phishing email",
        { category: "tips", goal: "education", platforms: ["linkedin"] },
      ],
      ["ironroots", "Proper squat form", { category: "tips", goal: "education" }],
      [
        "greenbasket",
        "How to store vegetables so they last",
        { category: "tips", goal: "education" },
      ],
      ["brightpath", "Study timetable for exam month", { category: "tips", goal: "education" }],
      [
        "motorhaus",
        "How to wash a car without swirl marks",
        { category: "tips", goal: "education" },
      ],
      [
        "lexbridge",
        "What a trademark protects",
        { category: "myth", goal: "education", platforms: ["linkedin"] },
      ],
    ],
  ),
  ...many(
    "ugc",
    ["tiktok", "instagram"],
    [
      ["velvetbare", "UGC ad for the Barrier Repair Serum"],
      ["noorthreads", "UGC unboxing of the Eid lawn suit"],
      ["ledgerly", "UGC review of the receipt scanner app"],
      ["greenbasket", "UGC unboxing of the weekly veg box"],
      ["ironroots", "UGC story of a beginner's first month"],
    ],
  ),
  ...many(
    "video",
    ["instagram", "tiktok"],
    [
      [
        "karachigrill",
        "Reel for the family BBQ deal",
        { videoKind: "offer-teaser", goal: "offer" },
      ],
      [
        "promptpilot",
        "Explainer of how Brief Agent works",
        { videoKind: "how-it-works", platforms: ["linkedin"] },
      ],
      ["motorhaus", "Before and after ceramic coating", { videoKind: "before-after" }],
      ["hunzatrails", "Hunza tour mood reel", { videoKind: "mood-broll" }],
      ["lexbridge", "Founder brand story", { videoKind: "brand-story", platforms: ["linkedin"] }],
    ],
  ),
  ...many(
    "campaign",
    ["instagram", "facebook"],
    [
      ["noorthreads", "Eid collection launch", { playbook: "product-launch", goal: "offer" }],
      ["karachigrill", "Ramadan iftar deals", { playbook: "seasonal", goal: "offer" }],
      ["brightpath", "New O-level batch registrations", { playbook: "event", goal: "leads" }],
      [
        "promptpilot",
        "Brief Agent launch",
        { playbook: "product-launch", goal: "leads", platforms: ["linkedin"] },
      ],
      ["petalpost", "Valentine's sale", { playbook: "sale", goal: "offer" }],
      ["ironroots", "New year beginner challenge", { playbook: "event", goal: "leads" }],
      ["thelinen", "Summer weekend escapes", { playbook: "seasonal", goal: "offer" }],
      [
        "stacksecure",
        "Free security check webinar",
        { playbook: "event", goal: "leads", platforms: ["linkedin"] },
      ],
      ["greenbasket", "First box half price", { playbook: "sale", goal: "offer" }],
      ["hunzatrails", "October Hunza tour early bird", { playbook: "sale", goal: "offer" }],
    ],
  ),
];

export function brandOf(id: string): BenchBrand {
  const brand = BRANDS.find((x) => x.id === id);
  if (!brand) throw new Error(`unknown bench brand ${id}`);
  return brand;
}
