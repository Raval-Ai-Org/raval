// catalog.ts — the one list of apps Mellox connects to (ADR-0042).
//
// Pure and browser-safe. Settings → Connections draws from it, the server's
// action guard (src/server/integrations/execute.server.ts) refuses any tool
// that is not listed for its app, and nothing else in the codebase may name a
// Composio tool slug.
//
// Rules:
//   * Only what Mellox really does with an app goes in `does`. An app whose
//     workflow isn't built yet is `later` and is not shown.
//   * `testing` apps connect only where the integrations flag is turned on for
//     a workspace (FEATURE_FLAG_INTEGRATIONS_TESTING_WS_<id>), until the
//     capability check in docs/integrations/capability-matrix.md passes.
//   * Tools are an allow-list per app. Destructive tools (delete, archive,
//     remove) are never listed; a test enforces it.
//   * Only OAuth sign-in. Mellox never asks a person to paste an API key.

export type IntegrationCategory =
  | "social"
  | "community"
  | "website"
  | "analytics"
  | "commerce"
  | "crm"
  | "email"
  | "productivity"
  | "design"
  | "team"
  | "ads";

/** How Mellox talks to the app. */
export type IntegrationMethod =
  /** Composio connected account (src/server/integrations/composio/). */
  | "composio"
  /** Mellox's own connector code (src/server/connectors/, src/server/slack/, ...). */
  | "direct"
  /** Post for Me social account (src/lib/postforme/). */
  | "postforme"
  /** Public search or an open API; nothing to connect. */
  | "search";

export type IntegrationAvailability = "live" | "testing" | "needs_approval" | "later";

export type ToolRole = "viewer" | "editor" | "admin";

export type IntegrationTool = {
  /** Composio tool slug, exactly. */
  slug: string;
  /** Changes something in the app. Needs an approval reference to run. */
  write: boolean;
  /** Lowest workspace role that may cause it to run. */
  minRole: ToolRole;
};

/**
 * One endpoint of an app's own API that Mellox may call through Composio's
 * proxy. `path` is exact, except `:id` segments, which match one id
 * (letters, digits, `-` and `_`). Never a prefix or a wildcard.
 */
export type IntegrationProxyRule = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  write: boolean;
  minRole: ToolRole;
};

export type IntegrationApp = {
  id: string;
  name: string;
  category: IntegrationCategory;
  method: IntegrationMethod;
  availability: IntegrationAvailability;
  /** Composio toolkit slug; only for method "composio". */
  toolkit?: string;
  /** Plain lines: what Mellox does with it. Shown on the tile. */
  does: string[];
  /** Shown when the app can't be connected yet, or needs something first. */
  note?: string;
  /** More than one account of this app per workspace. */
  multiple?: boolean;
  tools: IntegrationTool[];
  /** The app's own API endpoints Mellox calls through Composio's proxy. */
  proxy?: IntegrationProxyRule[];
};

const read = (slug: string): IntegrationTool => ({ slug, write: false, minRole: "viewer" });
const write = (slug: string): IntegrationTool => ({ slug, write: true, minRole: "editor" });
const admin = (slug: string): IntegrationTool => ({ slug, write: true, minRole: "admin" });
const get = (path: string): IntegrationProxyRule => ({
  method: "GET",
  path,
  write: false,
  minRole: "viewer",
});
const post = (path: string): IntegrationProxyRule => ({
  method: "POST",
  path,
  write: true,
  minRole: "editor",
});

export const INTEGRATION_APPS: readonly IntegrationApp[] = [
  // ── Social: Composio where its sign-in and tools work ───────────────────
  {
    id: "instagram",
    name: "Instagram",
    category: "social",
    method: "composio",
    toolkit: "instagram",
    availability: "testing",
    does: ["Post photos, carousels and Reels", "Read how each post did"],
    note: "Business or Creator accounts only.",
    multiple: true,
    tools: [
      read("INSTAGRAM_GET_USER_INFO"),
      read("INSTAGRAM_GET_IG_USER_MEDIA"),
      read("INSTAGRAM_GET_IG_MEDIA"),
      read("INSTAGRAM_GET_IG_MEDIA_CHILDREN"),
      read("INSTAGRAM_GET_IG_MEDIA_INSIGHTS"),
      read("INSTAGRAM_GET_USER_INSIGHTS"),
      read("INSTAGRAM_GET_IG_USER_CONTENT_PUBLISHING_LIMIT"),
      write("INSTAGRAM_POST_IG_USER_MEDIA"),
      write("INSTAGRAM_CREATE_CAROUSEL_CONTAINER"),
      write("INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH"),
    ],
  },
  {
    id: "facebook",
    name: "Facebook Pages",
    category: "social",
    method: "composio",
    toolkit: "facebook",
    availability: "testing",
    does: ["Post to your Page", "Read how each post did"],
    note: "Pages only, not personal profiles.",
    multiple: true,
    tools: [
      read("FACEBOOK_LIST_MANAGED_PAGES"),
      read("FACEBOOK_GET_PAGE_INSIGHTS"),
      read("FACEBOOK_GET_POST_INSIGHTS"),
      read("FACEBOOK_GET_SCHEDULED_POSTS"),
      write("FACEBOOK_CREATE_POST"),
      write("FACEBOOK_CREATE_PHOTO_POST"),
      write("FACEBOOK_CREATE_MULTI_PHOTO_POST"),
      write("FACEBOOK_CREATE_VIDEO_POST"),
    ],
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    category: "social",
    method: "composio",
    toolkit: "linkedin",
    availability: "testing",
    does: ["Post text, pictures and video", "Read how each post did"],
    note: "Video posts go to your own profile; company pages get text and pictures.",
    multiple: true,
    tools: [
      read("LINKEDIN_GET_SHARE_STATS"),
      read("LINKEDIN_GET_ORG_PAGE_STATS"),
      read("LINKEDIN_GET_MY_INFO"),
      read("LINKEDIN_GET_COMPANY_INFO"),
      read("LINKEDIN_GET_NETWORK_SIZE"),
      write("LINKEDIN_CREATE_LINKED_IN_POST"),
      write("LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE"),
      write("LINKEDIN_UPLOAD_VIDEO"),
      write("LINKEDIN_CREATE_VIDEO_POST"),
    ],
  },
  {
    id: "youtube",
    name: "YouTube",
    category: "social",
    method: "composio",
    toolkit: "youtube",
    availability: "testing",
    does: ["Upload videos and Shorts", "Read views and likes"],
    note: "Videos only. A picture post isn't sent to YouTube.",
    multiple: true,
    tools: [
      read("YOUTUBE_LIST_CHANNELS"),
      read("YOUTUBE_GET_CHANNEL_STATISTICS"),
      read("YOUTUBE_GET_VIDEO_DETAILS_BATCH"),
      write("YOUTUBE_UPLOAD_VIDEO"),
    ],
  },
  {
    id: "pinterest",
    name: "Pinterest",
    category: "social",
    method: "composio",
    toolkit: "pinterest",
    availability: "testing",
    does: ["Pin pictures to your boards", "Read how each Pin did"],
    multiple: true,
    tools: [
      read("PINTEREST_LIST_BOARDS"),
      read("PINTEREST_GET_PIN_ANALYTICS"),
      read("PINTEREST_GET_ACCOUNT_ANALYTICS"),
      read("PINTEREST_GET_MEDIA"),
      write("PINTEREST_CREATE_PIN"),
      write("PINTEREST_REGISTER_MEDIA"),
    ],
  },
  // ── Social: Post for Me, where Composio needs our own developer app ─────
  {
    id: "x",
    name: "X",
    category: "social",
    method: "postforme",
    availability: "live",
    does: ["Post and schedule", "Read how each post did"],
    multiple: true,
    tools: [],
  },
  {
    id: "threads",
    name: "Threads",
    category: "social",
    method: "postforme",
    availability: "live",
    does: ["Post and schedule", "Read how each post did"],
    multiple: true,
    tools: [],
  },
  {
    id: "tiktok",
    name: "TikTok",
    category: "social",
    method: "postforme",
    availability: "live",
    does: ["Post videos and photos", "Read how each post did"],
    multiple: true,
    tools: [],
  },
  // ── Community ────────────────────────────────────────────────────────────
  {
    id: "reddit",
    name: "Reddit",
    category: "community",
    method: "composio",
    toolkit: "reddit",
    availability: "needs_approval",
    does: ["Read full threads and community rules", "Post replies you approve"],
    note: "Waiting for Reddit's approval. Until then Mellox finds threads through search and you post replies yourself.",
    tools: [],
  },
  // ── Commerce, CRM, email, productivity: Composio, built per workflow ────
  {
    id: "shopify",
    name: "Shopify",
    category: "commerce",
    method: "composio",
    toolkit: "shopify",
    availability: "later",
    does: ["Keep your products up to date", "Count sales toward your goal"],
    tools: [],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "crm",
    method: "composio",
    toolkit: "hubspot",
    availability: "testing",
    does: ["Count new contacts toward your leads goal"],
    note: "Mellox only reads how many contacts were added. It never changes your CRM.",
    tools: [read("HUBSPOT_SEARCH_CONTACTS_BY_CRITERIA"), read("HUBSPOT_GET_ACCOUNT_INFO")],
  },
  {
    id: "klaviyo",
    name: "Klaviyo",
    category: "email",
    method: "composio",
    toolkit: "klaviyo",
    availability: "later",
    does: ["Save campaign emails as drafts in Klaviyo"],
    tools: [],
  },
  {
    id: "mailchimp",
    name: "Mailchimp",
    category: "email",
    method: "composio",
    toolkit: "mailchimp",
    availability: "testing",
    does: ["Save posts and campaign emails as drafts in Mailchimp"],
    note: "Drafts only. You check and send them in Mailchimp.",
    // Never SEND or SCHEDULE: a draft is all Mellox makes.
    tools: [
      read("MAILCHIMP_GET_LISTS_INFO"),
      write("MAILCHIMP_ADD_CAMPAIGN"),
      write("MAILCHIMP_SET_CAMPAIGN_CONTENT"),
    ],
  },
  {
    id: "googlesheets",
    name: "Google Sheets",
    category: "productivity",
    method: "composio",
    toolkit: "googlesheets",
    availability: "testing",
    does: ["Export your content calendar to a new sheet"],
    note: "Mellox makes a new sheet each time. It never edits your other sheets.",
    tools: [write("GOOGLESHEETS_CREATE_GOOGLE_SHEET1"), write("GOOGLESHEETS_UPDATE_VALUES_BATCH")],
  },
  {
    id: "googledrive",
    name: "Google Drive",
    category: "productivity",
    method: "composio",
    toolkit: "googledrive",
    availability: "testing",
    does: ["Save finished posts to a Mellox folder in your Drive"],
    note: "Mellox only adds new files. It never edits or removes anything in your Drive.",
    tools: [
      read("GOOGLEDRIVE_FIND_FOLDER"),
      write("GOOGLEDRIVE_CREATE_FOLDER"),
      write("GOOGLEDRIVE_UPLOAD_FROM_URL"),
      write("GOOGLEDRIVE_CREATE_FILE_FROM_TEXT"),
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    category: "email",
    method: "composio",
    toolkit: "gmail",
    availability: "testing",
    does: ["Save posts and articles as Gmail drafts"],
    note: "Drafts only. Mellox never sends email from your account.",
    // Never SEND: a draft is all Mellox makes.
    tools: [read("GMAIL_GET_PROFILE"), write("GMAIL_CREATE_EMAIL_DRAFT")],
  },
  // ── Ads: everything is made paused; nothing spends until you turn it on ──
  {
    id: "googleads",
    name: "Google Ads",
    category: "ads",
    method: "composio",
    toolkit: "googleads",
    availability: "testing",
    does: ["Turn a Studio ad into a paused Search campaign"],
    note: "Made paused. Add your keywords, then turn it on in Google Ads. Nothing spends before that.",
    // Spending money is an admin's call: every write needs an admin.
    tools: [
      read("GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS"),
      admin("GOOGLEADS_MUTATE_CAMPAIGN_BUDGETS"),
      admin("GOOGLEADS_MUTATE_CAMPAIGNS_V2"),
      admin("GOOGLEADS_MUTATE_AD_GROUPS"),
      admin("GOOGLEADS_MUTATE_AD_GROUP_ADS"),
    ],
  },
  {
    id: "tiktok_ads",
    name: "TikTok Ads",
    category: "ads",
    method: "composio",
    toolkit: "tiktok_ads",
    availability: "later",
    does: ["Turn a Studio video into a paused TikTok ad"],
    tools: [],
  },
  // ── Mellox's own connectors (shown by their existing cards) ─────────────
  {
    id: "github",
    name: "GitHub",
    category: "website",
    method: "direct",
    availability: "live",
    does: ["Fix your site through pull requests", "Publish articles"],
    tools: [],
  },
  {
    id: "wordpress",
    name: "WordPress",
    category: "website",
    method: "direct",
    availability: "live",
    does: ["Fix pages", "Publish articles"],
    tools: [],
  },
  {
    id: "webflow",
    name: "Webflow",
    category: "website",
    method: "direct",
    availability: "live",
    does: ["Fix pages", "Publish articles"],
    tools: [],
  },
  {
    id: "google",
    name: "Google Analytics and Search Console",
    category: "analytics",
    method: "direct",
    availability: "live",
    does: ["Website and search numbers"],
    tools: [],
  },
  // Canva's own API, signed by Composio: the edit flow in
  // src/server/connectors/canva/ calls exactly these endpoints.
  {
    id: "canva",
    name: "Canva",
    category: "design",
    method: "composio",
    toolkit: "canva",
    availability: "testing",
    does: ["Edit pictures and carousels in Canva", "Bring your changes back to the post"],
    tools: [],
    proxy: [
      get("/users/me"),
      post("/asset-uploads"),
      get("/asset-uploads/:id"),
      post("/designs"),
      get("/designs/:id"),
      post("/image-to-design-imports"),
      get("/image-to-design-imports/:id"),
      post("/imports"),
      get("/imports/:id"),
      post("/exports"),
      get("/exports/:id"),
    ],
  },
  {
    id: "notion",
    name: "Notion",
    category: "productivity",
    method: "direct",
    availability: "live",
    does: ["Sync your content calendar"],
    tools: [],
  },
  {
    id: "slack",
    name: "Slack",
    category: "team",
    method: "direct",
    availability: "live",
    does: ["Approve posts and get updates in Slack"],
    tools: [],
  },
];

const BY_ID = new Map(INTEGRATION_APPS.map((app) => [app.id, app]));

export function integrationApp(id: string): IntegrationApp | null {
  return BY_ID.get(id) ?? null;
}

/** Apps a person can connect through Composio here (testing ones only where allowed). */
export function connectableApps(opts: { testing: boolean }): IntegrationApp[] {
  return INTEGRATION_APPS.filter(
    (app) =>
      app.method === "composio" &&
      (app.availability === "live" || (opts.testing && app.availability === "testing")),
  );
}

export function isConnectable(app: IntegrationApp, opts: { testing: boolean }): boolean {
  return (
    app.method === "composio" &&
    (app.availability === "live" || (opts.testing && app.availability === "testing"))
  );
}

/** The allow-listed tool, or null. Matching is exact: slugs are never patterns. */
export function allowedTool(app: IntegrationApp, slug: string): IntegrationTool | null {
  return app.tools.find((tool) => tool.slug === slug) ?? null;
}

const PROXY_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** The allow-listed proxy endpoint, with a readable label, or null. */
export function allowedProxy(
  app: IntegrationApp,
  method: string,
  endpoint: string,
): (IntegrationProxyRule & { label: string }) | null {
  if (!/^\/[A-Za-z0-9/_-]*$/.test(endpoint)) return null;
  const parts = endpoint.split("/");
  for (const rule of app.proxy ?? []) {
    if (rule.method !== method) continue;
    const pattern = rule.path.split("/");
    if (pattern.length !== parts.length) continue;
    if (pattern.every((seg, i) => (seg === ":id" ? PROXY_ID.test(parts[i]) : seg === parts[i])))
      return { ...rule, label: rule.path };
  }
  return null;
}

const ROLE_RANK: Record<ToolRole, number> = { viewer: 0, editor: 1, admin: 2 };

export function roleAllows(role: string, min: ToolRole): boolean {
  const rank = role === "owner" ? 3 : role in ROLE_RANK ? ROLE_RANK[role as ToolRole] : -1;
  return rank >= ROLE_RANK[min];
}

/** Words that mark a tool as destructive. Never allowed in the catalog. */
export const DESTRUCTIVE_WORDS = ["DELETE", "ARCHIVE", "REMOVE", "PURGE", "REVOKE"] as const;

/** Composio user id for a workspace. Derived, never stored or taken from a request. */
export function composioUserId(workspaceId: string): string {
  return `mellox_ws_${workspaceId}`;
}
