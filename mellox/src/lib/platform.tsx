import {
  BarChart3,
  Brain,
  CalendarRange,
  Clapperboard,
  FlaskConical,
  Link2,
  MessagesSquare,
  Plane,
  ScanSearch,
  Share2,
  Users,
  type LucideIcon,
} from "lucide-react";

// What Mellox does for users, in one place. Two views of the same product:
//   JOURNEY  the order a brand moves through it (the animated flow on the home page and /features)
//   PILLARS  everything it can do, grouped by area (the home grid and the sections on /features)
// Mox, the 3D character, guides both. Pose names are files in /public/mox/cut.

export type MoxPose =
  | "wave"
  | "stand"
  | "face"
  | "visor"
  | "shop"
  | "chat"
  | "search"
  | "calendar"
  | "relax"
  | "jump"
  | "thumbs"
  | "think"
  | "suit"
  | "coffee"
  | "write";

export type SceneId = "site" | "goal" | "brains" | "studio" | "publish" | "autopilot" | "results";

export type JourneyStep = {
  id: SceneId;
  tab: string;
  eyebrow: string;
  title: string;
  text: string;
  points: string[];
  /** what Mox says in the speech bubble */
  say: string;
  pose: MoxPose;
  color: string;
};

export const JOURNEY: JourneyStep[] = [
  {
    id: "site",
    tab: "Your website",
    eyebrow: "01 · BRAND DNA",
    title: "Paste your website. Mellox learns your brand.",
    text: "One scan reads your site and builds your brand profile: voice, colours, offer, products and audience. The same scan fills in your audience groups and finds your competitors.",
    points: ["Voice, colours, offer and products", "Audience groups built from your site", "Competitors found for you to approve"],
    say: "Give me a link. I'll do the reading.",
    pose: "search",
    color: "#CBE960",
  },
  {
    id: "goal",
    tab: "Goal and products",
    eyebrow: "02 · YOUR TARGETS",
    title: "Tell it what winning looks like.",
    text: "Set your own targets. Mellox finds your products on your site so it can feature them in posts, and measures progress only from real results.",
    points: ["Your goal, in your numbers", "Product catalogue found from your site", "Progress counted from posts that really went out"],
    say: "Your numbers. Your products. I keep score.",
    pose: "shop",
    color: "#FE7032",
  },
  {
    id: "brains",
    tab: "Brain and strategy",
    eyebrow: "03 · BRAND BRAIN",
    title: "Four brains. One plan you confirm.",
    text: "Brand, Audience, Competitors and Market work together and write one marketing strategy for your brand: goals, channels and pace. Nothing is made from it until you confirm.",
    points: ["Real, dated, linked market news and trends", "A look for your brand set once in Inspo", "Content follows the plan only after you confirm"],
    say: "Four specialists, one answer. You make the final call.",
    pose: "think",
    color: "#B489D1",
  },
  {
    id: "studio",
    tab: "Studio",
    eyebrow: "04 · STUDIO",
    title: "Say what you want. Get every format.",
    text: "Posts, pictures, carousels, ads, articles and video, all in your brand's look and voice. Turn any finished piece into other formats with one click.",
    points: ["Designed posts and product hero posters", "Carousels, ads, articles and 12 video styles", "Edit chat, versions and undo"],
    say: "One idea in. A whole set of content out.",
    pose: "write",
    color: "#0756E7",
  },
  {
    id: "publish",
    tab: "Approve and publish",
    eyebrow: "05 · PUBLISH",
    title: "You approve. It goes out everywhere.",
    text: "See everything on one calendar. Approve a post, then post now or schedule it to Instagram, Facebook, LinkedIn, YouTube, Pinterest, X, Threads and TikTok. Clients can approve from a private link.",
    points: ["One calendar for every channel", "Nothing publishes without approval", "Private client portal for sign-off"],
    say: "Nothing goes out until you say so.",
    pose: "calendar",
    color: "#EE3445",
  },
  {
    id: "autopilot",
    tab: "Autopilot",
    eyebrow: "06 · AUTOPILOT",
    title: "Or let Mellox run the week for you.",
    text: "Switch Autopilot on and Mellox plans each week, writes and designs the posts and schedules them. You choose whether to approve each post or let it publish itself.",
    points: ["Weekly plan from your strategy", "Approve each post, or go fully automatic", "Weekly report and AI-visibility scan"],
    say: "Put your feet up. I've got this week.",
    pose: "relax",
    color: "#23FD36",
  },
  {
    id: "results",
    tab: "Results",
    eyebrow: "07 · MEASURE AND GET FOUND",
    title: "See what worked. Get found by AI.",
    text: "Analytics for every post on your connected accounts, plus an AI Visibility score for how ChatGPT, Perplexity and Google describe you, with fixes you approve first.",
    points: ["How every post performed, even outside Mellox", "AI Visibility score, before and after", "Ask the chat assistant anything about your data"],
    say: "Look at that. Growth you can prove.",
    pose: "jump",
    color: "#0756E7",
  },
];

export type Pillar = {
  id: string;
  icon: LucideIcon;
  title: string;
  tagline: string;
  text: string;
  /** what the user gets, from the product */
  features: { title: string; text: string }[];
  pose: MoxPose;
  color: string;
  /** deeper page, when one exists; otherwise the section on /features */
  href: string;
  badge?: string;
};

export const PILLARS: Pillar[] = [
  {
    id: "brain",
    icon: Brain,
    title: "Brand Brain",
    tagline: "Your brand, understood.",
    text: "Paste your website and Mellox builds everything it needs to know about your brand, your customers, your rivals and your market.",
    features: [
      { title: "Brand DNA", text: "Voice, colours, offer, products and audience, read from your website." },
      { title: "Audience", text: "Customer groups built from your site. Every post gets a score for how it should land, and two versions can be compared." },
      { title: "Competitors", text: "Finds rivals for you to approve, then tracks what they post and announce." },
      { title: "Market", text: "Real, dated, linked web news and trends about your market, summarised." },
      { title: "Marketing strategy", text: "One plan per brand covering goals, channels and pace. Content is made from it only once you confirm it." },
      { title: "Inspo", text: "Set your brand's look with reference images and a voice sample. Every post follows it." },
      { title: "Goals and products", text: "Set your own targets and keep a product catalogue. Mellox finds products on your site and can feature them in posts." },
    ],
    pose: "think",
    color: "#B489D1",
    href: "/features/four-brains",
  },
  {
    id: "studio",
    icon: Clapperboard,
    title: "Studio",
    tagline: "Every format, in your brand's look.",
    text: "Make social posts, pictures, carousels, ads, articles and video from one prompt, then turn any piece into other formats.",
    features: [
      { title: "Social posts", text: "Captions that read naturally, written for each platform." },
      { title: "Pictures", text: "Designed posts, posters, product hero shots and layouts built from your own photos. Edit by chat, keep multiple versions, and undo." },
      { title: "Carousels", text: "Multi-slide stories, including seamless connected slides." },
      { title: "Ads", text: "Built around a goal such as sales, leads or clicks, with Google search ad text." },
      { title: "Articles", text: "Long-form blog content." },
      { title: "Video", text: "Story, mood, product, creator-style UGC and motion graphics, with voiceover and music, reels from your website, and smart cuts and captions for your own footage. Every video is quality-checked first." },
      { title: "Make more from this", text: "Turn one finished piece into other formats." },
      { title: "Ideas deck, Library and calendar", text: "Swipe through ideas, keep everything in one Library where hearts teach Mellox your taste, and plan by date." },
    ],
    pose: "write",
    color: "#0756E7",
    href: "/features/four-brains",
  },
  {
    id: "autopilot",
    icon: Plane,
    title: "Autopilot",
    tagline: "Marketing that runs itself.",
    text: "Tell Mellox to run your marketing. It plans each week, writes and designs the posts, and schedules them on your channels.",
    features: [
      { title: "You choose the control", text: "Approve each post, or let it publish itself." },
      { title: "Weekly AI-visibility scan", text: "Checks how AI assistants see your site, every week." },
      { title: "Reuse your best posts", text: "Brings back what already worked." },
      { title: "Weekly report", text: "An email summary of the week." },
      { title: "Publish approved articles", text: "Articles you approved go to your website." },
    ],
    pose: "relax",
    color: "#23FD36",
    href: "/features/autopilot",
  },
  {
    id: "campaigns",
    icon: CalendarRange,
    title: "Campaigns",
    tagline: "A full campaign around a key date.",
    text: "Pick a kind of campaign, such as a launch, offer or event, and set the date. Mellox plans the phases and makes the posts for each one.",
    features: [
      { title: "A playbook for each kind", text: "Launch, offer, event, giveaway, hiring, grand opening and more." },
      { title: "Plans and posts made for you", text: "Phases, posts and Stories, written with your brand's results and current trends." },
      { title: "You set the goal", text: "You enter the numbers yourself. Mellox never guesses them." },
      { title: "You stay in control", text: "Posts wait for your approval, and you get an email when something needs you." },
    ],
    pose: "calendar",
    color: "#EE3445",
    href: "/features#campaigns",
  },
  {
    id: "chat",
    icon: MessagesSquare,
    title: "Chat assistant",
    tagline: "Ask anything about your brand.",
    text: "Ask about your brand and your data. Chat remembers what matters to your brand and reads your analytics, campaigns and content.",
    features: [
      { title: "Remembers your brand", text: "Saves what matters, and you can undo it." },
      { title: "One-click actions", text: "It offers buttons for actions and opens the right place in the app." },
      { title: "Searches the web", text: "Only when the question needs it." },
    ],
    pose: "chat",
    color: "#FE7032",
    href: "/features#chat",
  },
  {
    id: "visibility",
    icon: ScanSearch,
    title: "AI Visibility",
    tagline: "Get recommended by AI.",
    text: "Checks how well your website shows up in AI answers such as ChatGPT, Perplexity and Google, and fixes what holds it back.",
    features: [
      { title: "Visibility scan", text: "A score for how AI assistants see your site." },
      { title: "Fix suggestions", text: "A plain list of what to fix and why." },
      { title: "Fixes you approve", text: "Made as a GitHub pull request, or directly on WordPress and Webflow. Fix all with one approval." },
      { title: "A blog on your site", text: "Add a blog and publish articles to it." },
      { title: "Proof", text: "A rescan shows the score before and after." },
    ],
    pose: "search",
    color: "#0756E7",
    href: "/features/ai-visibility",
  },
  {
    id: "experiments",
    icon: FlaskConical,
    title: "Experiments",
    tagline: "Prove what works on your own pages.",
    text: "Run controlled SEO tests: change one thing, such as a title or heading, on half of a group of similar pages. Mellox ships the change and reports the result.",
    features: [
      { title: "One change, one comparison", text: "Half the pages get the change; the rest are the control." },
      { title: "You approve every change", text: "It ships as a pull request you review." },
      { title: "A clear verdict", text: "Reported at checkpoints, with client-ready reports." },
    ],
    pose: "thumbs",
    color: "#B489D1",
    href: "/features#experiments",
    badge: "Early access",
  },
  {
    id: "analytics",
    icon: BarChart3,
    title: "Analytics",
    tagline: "See what is working.",
    text: "Know how every post performed and which days and formats work best, without wiring up a dashboard first.",
    features: [
      { title: "Social", text: "How every post on your connected accounts performed, including posts made outside Mellox, plus the days and formats that work best." },
      { title: "Website and Search", text: "Traffic and search performance, once you connect Google." },
      { title: "Overview and insights", text: "One summary, with plain-language insights." },
    ],
    pose: "jump",
    color: "#CBE960",
    href: "/features#analytics",
  },
  {
    id: "publishing",
    icon: Share2,
    title: "Publishing and connections",
    tagline: "Everywhere your brand lives.",
    text: "Post to eight social networks and connect the tools you already use. Post now or schedule, at no extra cost.",
    features: [
      { title: "Social networks", text: "Instagram, Facebook, LinkedIn, YouTube, Pinterest, X, Threads and TikTok." },
      { title: "Your tools", text: "Google Drive, Gmail, Sheets and Ads, Mailchimp, HubSpot, Canva, Slack, and WordPress, Webflow, Wix and GitHub for your website." },
      { title: "AI assistants", text: "Claude and other assistants can work with your Mellox workspace." },
      { title: "Reddit communities", text: "Mellox finds relevant threads for you." },
    ],
    pose: "coffee",
    color: "#FE7032",
    href: "/integrations",
  },
  {
    id: "team",
    icon: Users,
    title: "Team and clients",
    tagline: "Bring everyone in.",
    text: "Invite teammates with roles, and share a private link so clients can view and approve posts.",
    features: [
      { title: "Team", text: "Invite teammates with roles." },
      { title: "Client portal", text: "A private link where clients view and approve posts, and you see their feedback." },
      { title: "Publish list", text: "Everything approved, scheduled or on its way out." },
    ],
    pose: "suit",
    color: "#EE3445",
    href: "/features/agency-mode",
  },
];

export const COMING_SOON = {
  icon: Link2,
  title: "Backlink buying",
  text: "Purchase real placements on other sites, then check each link is live.",
};

/** Social networks Mellox publishes to, with the logo files in /public/llms. */
export const NETWORKS: { name: string; logo: string }[] = [
  { name: "Instagram", logo: "instagram" },
  { name: "Facebook", logo: "facebook" },
  { name: "LinkedIn", logo: "linkedin" },
  { name: "YouTube", logo: "youtube" },
  { name: "Pinterest", logo: "pinterest" },
  { name: "X", logo: "x" },
  { name: "Threads", logo: "threads" },
  { name: "TikTok", logo: "tiktok" },
];
