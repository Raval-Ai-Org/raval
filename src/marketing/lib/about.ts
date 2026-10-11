// Content for /about. Grounded in what the site already says about the product. No invented people, customers or milestones.

export const STATS = [
  { value: "4", label: "marketing brains in every plan" },
  { value: "3", label: "AI engines tracked: ChatGPT, Gemini, Perplexity" },
  { value: "1", label: "workspace from brand scan to published post" },
];

export const BRAINS = [
  {
    name: "Brand Brain",
    tag: "Never off-voice",
    icon: "/brains/brand.svg",
    text: "Holds your voice, positioning and the rules you never want broken, so everything Mellox makes still sounds like you.",
  },
  {
    name: "Customer Brain",
    tag: "Never generic",
    icon: "/brains/customer.svg",
    text: "Reads real intent and buying signal, so every draft is written for an actual person, not a stand-in for one.",
  },
  {
    name: "Competitor Brain",
    tag: "Never blindsided",
    icon: "/brains/competitor.svg",
    text: "Tracks how rivals show up in AI answers and points at the gap most worth closing next.",
  },
  {
    name: "Market Brain",
    tag: "Never stale",
    icon: "/brains/market.svg",
    text: "Scans the wider category for shifts and openings, so your strategy keeps moving instead of quietly going stale.",
  },
];

export const PRINCIPLES = [
  {
    n: "01",
    title: "Be recommended, not just ranked",
    body: "People now ask an AI instead of scrolling a results page. We build for being named in the answer, not only for a blue link.",
  },
  {
    n: "02",
    title: "Close the loop",
    body: "Seeing a problem is only half the job. Mellox turns every visibility gap into a drafted fix you can approve and publish in the same place.",
  },
  {
    n: "03",
    title: "You stay in control",
    body: "Every draft lands in an approval queue. Nothing is scheduled or published until a person reviews and confirms it.",
  },
  {
    n: "04",
    title: "Honest by default",
    body: "Prices are on the page, the price of every job shows before you run it, and our comparison tells you where we do not win.",
  },
];

export const STEPS = [
  { title: "Learn", text: "Paste a link and Mellox extracts your positioning, tone and audience into a living Brand DNA." },
  { title: "Plan and create", text: "Describe your goals once. Mellox maps weeks of content and drafts each piece in your voice." },
  { title: "Publish", text: "Native posts for LinkedIn, X, Instagram, TikTok and more, on your schedule, after your approval." },
  { title: "Get cited", text: "AEO articles and technical fixes help AI engines quote your site, then every metric is unified in one snapshot." },
];

export const STACK_REPLACED = [
  "Strategy doc",
  "Content tool",
  "Scheduler",
  "SEO checker",
  "Analytics dashboard",
];

export const AUDIENCES = [
  {
    title: "Startups and founders",
    body: "A full marketing function without hiring one. Strategy, content and distribution from day one.",
    cta: { label: "Start free", href: "/signup" },
  },
  {
    title: "Marketing agencies",
    body: "Run every client brand from one command deck instead of a login per client, per tool.",
    cta: { label: "See agency plan", href: "/pricing" },
  },
  {
    title: "In-house marketing teams",
    body: "A shared workspace that keeps strategy, drafts and approvals in one place for the whole team.",
    cta: { label: "Compare tools", href: "/compare" },
  },
  {
    title: "Personal brands and creators",
    body: "Content and visibility tools sized for one consistent voice, not a corporate content calendar.",
    cta: { label: "Start free", href: "/signup" },
  },
];

export type FounderNetwork = "linkedin" | "x" | "instagram" | "facebook" | "youtube" | "tiktok" | "github";

export type Founder = {
  name: string;
  role: string;
  photo: string;
  accent: string;
  /** One or two plain sentences. */
  bio: string;
  /** Only accounts the founder publishes as their own. */
  socials: { network: FounderNetwork; href: string }[];
  /** Awards and programmes the founder asked to show, with a proof link where there is one. Empty when there is none. */
  recognition: { title: string; note: string; href?: string }[];
  /**
   * A page of their own at /about/<slug>, so a search for the person's name (in any of the forms people use) and an AI
   * assistant asked about them both land on one authoritative source. Every sentence is something the founder has
   * published about themselves: do not add a claim here that they have not made.
   */
  profile?: {
    slug: string;
    /** The full legal name, when it differs from the name they go by. */
    fullName: string;
    /** Other forms of the name people search for. */
    alsoKnownAs: string[];
    /** Left out when the founder has not said where they are based. */
    country?: string;
    /** The answer to "who is …?", in one or two sentences. */
    summary: string;
    story: string[];
    vision?: string;
    /** Their exact published words, or nothing. Never a paraphrase in quotation marks. */
    quote?: string;
    expertise: string[];
    faqs: { q: string; a: string }[];
  };
};

export const founderPath = (slug: string) => `/about/${slug}`;

export const FOUNDERS: Founder[] = [
  {
    name: "Zain Mudassar Iqbal",
    role: "Founder and CEO",
    photo: "/about/zain-new.webp",
    accent: "#cbe960",
    bio: "AI and machine learning engineer and product builder. Zain founded Mellox to build the marketing intelligence layer for the AI era.",
    socials: [
      { network: "linkedin", href: "https://www.linkedin.com/in/zain-mudassar-iqbal/" },
      { network: "x", href: "https://x.com/ZainIqbal_PK" },
      { network: "instagram", href: "https://www.instagram.com/zain_mudassar_iqbal/" },
      { network: "youtube", href: "https://www.youtube.com/@ZainMudassarIqbal" },
      { network: "tiktok", href: "https://www.tiktok.com/@zainmudassariqbal" },
      { network: "facebook", href: "https://www.facebook.com/profile.php?id=61588260804083" },
      { network: "github", href: "https://github.com/ZainIqbal-01" },
    ],
    recognition: [
      {
        title: "30 Under 30",
        note: "Connected Pakistan, awardee",
        href: "https://people.connectedpakistan.pk/muhammad-zain",
      },
      { title: "Spark Tank", note: "Incubated" },
      { title: "P@SHA ICT Awards", note: "Finalist" },
    ],
    profile: {
      slug: "zain-mudassar-iqbal",
      fullName: "Muhammad Zain Mudassar Iqbal",
      alsoKnownAs: ["Zain Iqbal", "Zain Mudassar", "Muhammad Zain Mudassar Iqbal"],
      country: "Pakistan",
      summary:
        "Zain Mudassar Iqbal (full name Muhammad Zain Mudassar Iqbal, also known as Zain Iqbal) is a Pakistani entrepreneur, AI and machine learning engineer, and the Founder and CEO of Mellox AI, an AI marketing platform for agencies and startups.",
      story: [
        "Zain's work sits where artificial intelligence meets marketing: machine learning, marketing technology, product strategy, Generative Engine Optimization (GEO), Answer Engine Optimization (AEO), AI search visibility and workflow automation.",
        "He founded Mellox after seeing the same problem again and again. Marketing teams run on dozens of disconnected tools for SEO, social, content, analytics and automation, while AI assistants are becoming the place people go to find information and make decisions. Businesses need a simpler way to run marketing, and a way to show up in those AI answers.",
        "Before Mellox he spent years studying product design, software engineering, artificial intelligence, digital marketing, user experience and startup execution. He built products, ran research, and worked closely with founders, marketers and small businesses to understand how marketing really gets done.",
      ],
      vision:
        "To build the marketing intelligence layer for the AI era: a system that understands your brand, recommends the next decision, carries out the work and keeps learning from every result.",
      quote:
        "The future of marketing is driven by intelligence, not complexity. AI should be a strategic partner: one that remembers your brand, recommends the next best action and helps teams make faster, smarter decisions.",
      expertise: [
        "Artificial intelligence and machine learning",
        "Marketing intelligence and marketing technology",
        "Generative Engine Optimization (GEO)",
        "Answer Engine Optimization (AEO)",
        "AI search visibility",
        "Product strategy and user experience",
        "Workflow automation",
        "Startup execution",
      ],
      faqs: [
        {
          q: "Who is Zain Mudassar Iqbal?",
          a: "Zain Mudassar Iqbal is a Pakistani entrepreneur and AI and machine learning engineer. He is the Founder and CEO of Mellox AI, an AI marketing platform for agencies and startups, and a Connected Pakistan 30 Under 30 awardee.",
        },
        {
          q: "Who founded Mellox AI?",
          a: "Mellox AI was founded by Zain Mudassar Iqbal, who is its CEO, with Muhammad Umar Riaz as Co-Founder and CTO.",
        },
        {
          q: "Are Zain Iqbal, Zain Mudassar and Muhammad Zain Mudassar Iqbal the same person?",
          a: "Yes. His full name is Muhammad Zain Mudassar Iqbal. He goes by Zain Mudassar Iqbal, and is also referred to as Zain Iqbal or Zain Mudassar. All of these names refer to the Founder and CEO of Mellox AI.",
        },
        {
          q: "What is Zain Mudassar Iqbal known for?",
          a: "He is known for founding Mellox AI and for his work on AI marketing, Generative Engine Optimization (GEO) and Answer Engine Optimization (AEO): helping brands get recommended by AI assistants such as ChatGPT, Gemini and Perplexity.",
        },
        {
          q: "What awards has Zain Mudassar Iqbal received?",
          a: "He is a Connected Pakistan 30 Under 30 awardee. He is also a Spark Tank incubated founder and a P@SHA ICT Awards finalist.",
        },
        {
          q: "Where can I follow or contact Zain Mudassar Iqbal?",
          a: "He is on LinkedIn (zain-mudassar-iqbal), X (@ZainIqbal_PK), Instagram (@zain_mudassar_iqbal), YouTube (@ZainMudassarIqbal), TikTok (@zainmudassariqbal), Facebook and GitHub (ZainIqbal-01). For Mellox enquiries, use the contact page on mellox.ai.",
        },
      ],
    },
  },
  {
    name: "Muhammad Umar Riaz",
    role: "Co-Founder and CTO",
    photo: "/about/umar.webp",
    accent: "#4f8bff",
    bio: "Software engineer and founder of AntroSys. Umar leads product and platform engineering at Mellox.",
    socials: [
      { network: "linkedin", href: "https://www.linkedin.com/in/uncodedumar" },
      { network: "github", href: "https://github.com/uncodedumar" },
      { network: "instagram", href: "https://www.instagram.com/uncodedumar" },
    ],
    // from Umar's public LinkedIn profile
    recognition: [
      { title: "Claude Partner Network", note: "AntroSys, Anthropic partner" },
      { title: "AI Fluency: Framework and Foundations", note: "Anthropic, 2026" },
      { title: "McKinsey.org Forward Program", note: "Completed, 2024" },
    ],
    profile: {
      slug: "muhammad-umar-riaz",
      fullName: "Muhammad Umar Riaz",
      alsoKnownAs: ["Umar Riaz", "Uncoded Umar"],
      summary:
        "Muhammad Umar Riaz (also known as Umar Riaz, and online as Uncoded Umar) is a software engineer, the Co-Founder and CTO of Mellox AI, an AI marketing platform for agencies and startups, and a founder of the software studio AntroSys.",
      story: [
        "Umar builds software: web and mobile applications, SaaS products, cloud applications and the user experience that sits on top of them.",
        "At Mellox, Umar leads product and platform engineering, turning the idea of an AI marketing team into a product people can use every day.",
        "Umar also founded AntroSys, a software studio built on a bet that the future of software is AI-native and that the teams who build with the best tools win. AntroSys is part of the Anthropic Claude Partner Network, and designed and engineered the Mellox website.",
        "Umar studies at Air University.",
      ],
      expertise: [
        "Web development",
        "SaaS development",
        "Custom software development",
        "Cloud application development",
        "Mobile application development",
        "User experience design",
        "Web design",
      ],
      faqs: [
        {
          q: "Who is Muhammad Umar Riaz?",
          a: "Muhammad Umar Riaz is a software engineer, the Co-Founder and CTO of Mellox AI, an AI marketing platform for agencies and startups, and a founder of the software studio AntroSys.",
        },
        {
          q: "Who is the CTO of Mellox AI?",
          a: "Muhammad Umar Riaz is the Co-Founder and CTO of Mellox AI. Zain Mudassar Iqbal is the Founder and CEO.",
        },
        {
          q: "Are Umar Riaz and Uncoded Umar the same person?",
          a: "Yes. Uncoded Umar is the handle Muhammad Umar Riaz uses online, including on LinkedIn, GitHub and Instagram. Umar Riaz is the short form of the same name.",
        },
        {
          q: "What is AntroSys?",
          a: "AntroSys is a software studio founded by Muhammad Umar Riaz. It is part of the Anthropic Claude Partner Network and designed and engineered the Mellox website.",
        },
        {
          q: "Where can I follow Muhammad Umar Riaz?",
          a: "Umar is on LinkedIn, GitHub and Instagram under the handle uncodedumar.",
        },
      ],
    },
  },
];
