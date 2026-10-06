// Every place in Mellox the message box can open: one list shared by the "/"
// menu, the buttons a reply offers and the server (which only knows the ids).
// Opening is always a person's click. Chat never opens a place by itself.
import type { AppEventMap, AppEventName } from "@/lib/app-events";

export type PlaceGroup = "Create" | "Brain" | "Grow" | "Plan" | "Workspace";

export type Place = {
  id: string;
  label: string;
  /** A few plain words, shown in the "/" menu. */
  hint: string;
  group: PlaceGroup;
  /** Extra words the "/" menu matches. */
  keywords: string[];
  event: AppEventName;
  detail?: AppEventMap[AppEventName];
};

const place = <E extends AppEventName>(
  p: Omit<Place, "event" | "detail"> & { event: E; detail?: AppEventMap[E] },
): Place => p as Place;

export const PLACES: readonly Place[] = [
  place({
    id: "studio",
    label: "Studio",
    hint: "Make a post, picture, video or article",
    group: "Create",
    keywords: ["create", "post", "image", "write", "content", "carousel", "story"],
    event: "open:create-launcher",
  }),
  place({
    id: "video-ads",
    label: "Video ads",
    hint: "Make a video ad for a product",
    group: "Create",
    keywords: ["ugc", "video", "ad"],
    event: "open:ugc-studio",
  }),
  place({
    id: "library",
    label: "Library",
    hint: "Everything you've made",
    group: "Create",
    keywords: ["posts", "media", "drafts", "files"],
    event: "open:library",
  }),
  place({
    id: "approvals",
    label: "Waiting for approval",
    hint: "Posts that need your OK",
    group: "Create",
    keywords: ["review", "approve", "pending"],
    event: "open:library",
    detail: { status: "review" },
  }),
  place({
    id: "brain",
    label: "Brain",
    hint: "What Mellox knows about your brand",
    group: "Brain",
    keywords: ["home", "updates", "notes"],
    event: "open:brain",
    detail: { section: "home" },
  }),
  place({
    id: "brand",
    label: "Brand DNA",
    hint: "Your brand's facts, look and voice",
    group: "Brain",
    keywords: ["voice", "colours", "colors", "logo", "fonts", "look"],
    event: "open:brain",
    detail: { section: "brand" },
  }),
  place({
    id: "audience",
    label: "Audience",
    hint: "Who you talk to",
    group: "Brain",
    keywords: ["customers", "groups", "score"],
    event: "open:brain",
    detail: { section: "audience" },
  }),
  place({
    id: "competitors",
    label: "Competitors",
    hint: "Who you're up against and what they did",
    group: "Brain",
    keywords: ["rivals", "watch"],
    event: "open:brain",
    detail: { section: "competitors" },
  }),
  place({
    id: "market",
    label: "Market",
    hint: "What's happening in your market",
    group: "Brain",
    keywords: ["trends", "news", "signals"],
    event: "open:brain",
    detail: { section: "market" },
  }),
  place({
    id: "strategy",
    label: "Strategy",
    hint: "The marketing plan Mellox follows",
    group: "Brain",
    keywords: ["plan", "goals", "pillars", "roadmap"],
    event: "open:brain",
    detail: { section: "strategy" },
  }),
  place({
    id: "visibility",
    label: "AI Visibility",
    hint: "How AI assistants see your website",
    group: "Grow",
    keywords: ["geo", "seo", "aeo", "scan", "audit", "website"],
    event: "open:ai-visibility",
  }),
  place({
    id: "backlinks",
    label: "Backlinks",
    hint: "Get links from other websites",
    group: "Grow",
    keywords: ["links", "placements", "seo"],
    event: "open:backlinks",
  }),
  place({
    id: "experiments",
    label: "Experiments",
    hint: "Test a change on your pages",
    group: "Grow",
    keywords: ["test", "proof", "ab"],
    event: "open:experiments",
  }),
  place({
    id: "analytics",
    label: "Analytics",
    hint: "How your content and website are doing",
    group: "Grow",
    keywords: ["numbers", "results", "stats", "performance"],
    event: "open:analytics",
  }),
  place({
    id: "calendar",
    label: "Calendar",
    hint: "What's planned and scheduled",
    group: "Plan",
    keywords: ["schedule", "dates", "plan"],
    event: "open:content-calendar",
  }),
  place({
    id: "autopilot",
    label: "Autopilot",
    hint: "Mellox plans and posts for you",
    group: "Plan",
    keywords: ["automatic", "auto", "hands off"],
    event: "open:autopilot",
  }),
  place({
    id: "clients",
    label: "Client portal",
    hint: "Share work with a client",
    group: "Workspace",
    keywords: ["share", "portal", "client"],
    event: "open:client-portal",
  }),
  place({
    id: "memory",
    label: "Memory",
    hint: "What your team told Mellox to remember",
    group: "Workspace",
    keywords: ["remember", "forget", "rules", "preferences"],
    event: "open:settings",
    detail: { section: "memory" },
  }),
  place({
    id: "connections",
    label: "Connections",
    hint: "Social accounts and other tools",
    group: "Workspace",
    keywords: ["accounts", "social", "connect", "instagram", "linkedin"],
    event: "open:settings",
    detail: { section: "accounts" },
  }),
  place({
    id: "settings",
    label: "Settings",
    hint: "Workspace settings",
    group: "Workspace",
    keywords: ["preferences", "theme"],
    event: "open:settings",
  }),
  place({
    id: "billing",
    label: "Plan & billing",
    hint: "Your plan and credits",
    group: "Workspace",
    keywords: ["credits", "upgrade", "plan", "usage"],
    event: "open:usage",
  }),
];

export const PLACE_IDS = PLACES.map((p) => p.id);

export function findPlace(id: unknown): Place | undefined {
  return PLACES.find((p) => p.id === id);
}
