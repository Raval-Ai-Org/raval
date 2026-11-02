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
};

const read = (slug: string): IntegrationTool => ({ slug, write: false, minRole: "viewer" });
const write = (slug: string): IntegrationTool => ({ slug, write: true, minRole: "editor" });

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
    does: ["Post to your profile or company page", "Read how each post did"],
    multiple: true,
    tools: [
      read("LINKEDIN_GET_SHARE_STATS"),
      read("LINKEDIN_GET_ORG_PAGE_STATS"),
      read("LINKEDIN_GET_NETWORK_SIZE"),
      write("LINKEDIN_CREATE_LINKED_IN_POST"),
      write("LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE"),
      write("LINKEDIN_INITIALIZE_IMAGE_UPLOAD"),
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
    multiple: true,
    tools: [
      read("YOUTUBE_LIST_CHANNELS"),
      read("YOUTUBE_GET_CHANNEL_STATISTICS"),
      read("YOUTUBE_GET_VIDEO_DETAILS_BATCH"),
      write("YOUTUBE_UPLOAD_VIDEO"),
      write("YOUTUBE_MULTIPART_UPLOAD_VIDEO"),
    ],
  },
  {
    id: "pinterest",
    name: "Pinterest",
    category: "social",
    method: "composio",
    toolkit: "pinterest",
    availability: "testing",
    does: ["Pin pictures and videos to your boards", "Read how each Pin did"],
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
    availability: "later",
    does: ["Count new leads toward your goal"],
    tools: [],
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
    availability: "later",
    does: ["Save campaign emails as drafts in Mailchimp"],
    tools: [],
  },
  {
    id: "googlesheets",
    name: "Google Sheets",
    category: "productivity",
    method: "composio",
    toolkit: "googlesheets",
    availability: "later",
    does: ["Export your calendar and reports"],
    tools: [],
  },
  {
    id: "googledrive",
    name: "Google Drive",
    category: "productivity",
    method: "composio",
    toolkit: "googledrive",
    availability: "later",
    does: ["Bring brand photos into your library"],
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
  {
    id: "canva",
    name: "Canva",
    category: "design",
    method: "direct",
    availability: "live",
    does: ["Edit pictures and carousels in Canva"],
    tools: [],
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
