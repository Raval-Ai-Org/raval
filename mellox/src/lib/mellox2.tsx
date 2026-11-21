import {
  BarChart3,
  CalendarRange,
  Clapperboard,
  Image as ImageIcon,
  Library,
  MessagesSquare,
  Palette,
  Sparkles,
  UserRound,
  Wand2,
  type LucideIcon,
} from "lucide-react";

// Content for the Mellox 2.0 release (21 Oct to 11 Nov 2026), from the website update brief.
// Used by the home page section and the /features overview. Mox is the 3D character who guides the app.

/** Mox headphone accent green. */
export const MOX_GREEN = "#23FD36";

export type Mellox2Section = {
  id: string;
  icon: LucideIcon;
  title: string;
  text: string;
  /** short bullet points shown on the features overview */
  points: string[];
  beta?: boolean;
  /** Mox art shown next to the section (files in /public/mox) */
  img?: string;
};

export const MELLOX2: Mellox2Section[] = [
  {
    id: "mox",
    icon: Sparkles,
    title: "Mellox 2.0 and Mox, our 3D character",
    text: "Meet Mox, the 3D character who guides you through Mellox: greetings, chat, onboarding, the tour and loading screens.",
    points: ["Greetings and chat with Mox", "Mox leads onboarding and the tour", "Mox keeps you company on loading screens"],
    img: "/mox/wave.webp",
  },
  {
    id: "ui",
    icon: Wand2,
    title: "New UI and UX",
    text: "The whole app is redesigned: a clean light theme, a soft Mox gradient and a simpler sidebar.",
    points: [
      "New Home with quick cards: Swipe ideas, Blog ideas, Animate and Autopilot",
      "New Create screen to pick how you want to make content",
      "Simpler Studio: one clean page from prompt to Generate",
      "Streaks and levels that grow with every piece you make",
      "New onboarding: scan your website, set your goal, choose your language, add your products, then press and hold to enter",
      "Smoother animations throughout",
      "Mox writes your content in your brand's language",
    ],
    img: "/mox/stand.webp",
  },
  {
    id: "campaigns",
    icon: CalendarRange,
    title: "Campaigns",
    text: "Plan a full campaign around a key date. Mellox builds the phases, posts and Stories for you.",
    points: [
      "16 campaign types: Product launch, Event or webinar, Seasonal, Sale or offer, Brand showcase, Teach a series, Memes and fun, Behind the scenes, Customer stories, Giveaway or contest, Free guide or sign-ups, Collab or partnership, Milestone, Grand opening, Hiring, Cause or awareness day",
      "Mellox writes the plan using your brand's results and current trends",
      "Posts are made automatically and wait for your approval",
      "You get an email when something needs you",
    ],
  },
  {
    id: "inspo",
    icon: Palette,
    title: "Inspo",
    text: "One place to set your brand's look: Board, Post look, Video look, Voice and Media.",
    points: [
      "Upload what you love and what to avoid, plus product photos and your team",
      "\"Learn my style\" studies your references and website so every post looks like your brand",
      "Upload up to 100 files at once",
    ],
  },
  {
    id: "reddit",
    icon: MessagesSquare,
    title: "Reddit agent",
    text: "Finds conversations and drafts replies you approve.",
    points: ["Finds Reddit conversations where your brand can help", "Drafts replies for you to approve", "Community threads show up in your weekly report"],
    beta: true,
  },
  {
    id: "video",
    icon: Clapperboard,
    title: "New video types",
    text: "12 video styles, each planned as a storyboard and quality checked before you get it.",
    points: [
      "Bring a post to life, Animate the product, Motion post, Product showcase, Short story, How it works, Before and after, Mood, Product demo, Beautiful shots from one line, Offer, Motion graphics",
      "Automatic soundtrack: a voiceover plus background music",
      "Motion graphics videos made from your logo, photos and words",
      "Edit your own clips with smart cuts and automatic captions",
    ],
  },
  {
    id: "ugc",
    icon: UserRound,
    title: "Creator UGC video ads",
    text: "Make creator-style video ads from one screen: choose a creator, product, script, emotion, place and length.",
    points: [
      "30 Reel formats: interviews, skits, talking to camera, reviews and lifestyle",
      "Instagram-style hook text on the video",
      "Create your own creator, or use your own team as the face of your brand",
    ],
  },
  {
    id: "posters",
    icon: ImageIcon,
    title: "Product hero posters and photo design",
    text: "Your real product photo is placed in a fresh, eye-catching scene every time, in your brand's colours.",
    points: [
      "Designs built around your own photos without redrawing them",
      "Carousels with connected slides that flow into each other",
    ],
  },
  {
    id: "library",
    icon: Library,
    title: "Library and taste",
    text: "A new Library that shows every piece at its true shape.",
    points: ["Heart what you love and Mellox learns your team's taste for future content"],
  },
  {
    id: "analytics",
    icon: BarChart3,
    title: "Social analytics",
    text: "See how all your social posts perform, including ones not made in Mellox.",
    points: ["New Ads and leads view from Google Ads and HubSpot", "Analytics now works without connecting Google"],
  },
];

export type NewConnector = { name: string; text: string; status: "live" | "soon" };

/** New connectors from the brief. `image`: logo file in /public/logos when we have the real one, else a monogram tile shows. */
export const NEW_CONNECTORS: (NewConnector & { image?: string; logo?: string })[] = [
  { name: "Instagram", logo: "instagram", text: "Publish posts and read their results", status: "live" },
  { name: "Facebook", logo: "facebook", text: "Publish posts and read their results", status: "live" },
  { name: "LinkedIn", logo: "linkedin", text: "Publish posts and read their results", status: "live" },
  { name: "YouTube", logo: "youtube", text: "Publish posts and read their results", status: "live" },
  { name: "Pinterest", logo: "pinterest", text: "Publish posts and read their results", status: "live" },
  { name: "Canva", image: "/logos/canva.webp", text: "Edit Mellox designs in Canva", status: "live" },
  { name: "Google Drive", image: "/logos/google-drive.svg", text: "Save your content to a Mellox folder", status: "live" },
  { name: "Gmail", image: "/logos/gmail.svg", text: "Save email drafts", status: "live" },
  { name: "Google Ads", image: "/logos/google-ads.svg", text: "Turn a Studio ad into a Search campaign, ready for you to launch", status: "live" },
  { name: "HubSpot", image: "/logos/hubspot.svg", text: "Track new leads against your goal", status: "live" },
  { name: "Mailchimp", image: "/logos/mailchimp.svg", text: "Turn a post into a draft email campaign", status: "live" },
  { name: "Google Sheets", image: "/logos/google-sheets.svg", text: "Export your content calendar", status: "live" },
  { name: "Wix", image: "/logos/wix.svg", text: "Connect your website", status: "live" },
  { name: "Reddit", logo: "reddit", text: "Coming soon (waiting for approval)", status: "soon" },
  { name: "Shopify", text: "Coming soon", status: "soon" },
  { name: "Klaviyo", text: "Coming soon", status: "soon" },
  { name: "TikTok Ads", logo: "tiktok", text: "Coming soon", status: "soon" },
];

/** Already live and staying on the page. */
export const EXISTING_CONNECTORS: { name: string; logo?: string; image?: string }[] = [
  { name: "X", logo: "x" },
  { name: "Threads", logo: "threads" },
  { name: "TikTok", logo: "tiktok" },
  { name: "GitHub", image: "/logos/github.svg" },
  { name: "WordPress", image: "/logos/wordpress.svg" },
  { name: "Webflow", image: "/logos/webflow.svg" },
  { name: "Google Analytics", image: "/logos/google-analytics.svg" },
  { name: "Search Console" },
  { name: "Notion", image: "/logos/notion.webp" },
  { name: "Slack", image: "/logos/slack.webp" },
];
