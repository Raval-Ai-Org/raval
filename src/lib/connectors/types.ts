// types.ts — the shared vocabulary of Mellox connectors: external systems a
// workspace connects so Mellox can read (and, later, propose changes to) the
// source behind a website. GitHub is the first provider; WordPress, Webflow,
// Framer and Shopify slot into the same records later.
//
// Plain data only — safe to import from the browser. Credentials never appear
// in these types: providers mint short-lived tokens server-side on demand.

import type { OwnershipEvidence, OwnershipStatus } from "./ownership";

export type GitHubDiagnostic = {
  appIdPresent: boolean;
  appSlugPresent: boolean;
  appNamePresent: boolean;
  privateKeyPresent: boolean;
  privateKeyValid: boolean;
  webhookSecretPresent: boolean;
  clientIdPresent: boolean;
  clientSecretPresent: boolean;
  appUrlPresent: boolean;
  appUrlHttps: boolean;
  callbackUrlValid: boolean;
  webhookUrlValid: boolean;
  appJwtGenerationValid: boolean;
  githubApiReachable: boolean;
  oauthConfigurationValid: boolean;
};

export type ConnectorProviderId = "github" | "wordpress" | "webflow" | "framer" | "shopify";

/** What a provider can do for a connected source. */
export type ConnectorCapability =
  /** Read files and metadata from the site's source (e.g. a repository). */
  | "source_read"
  /** Open a branch + pull request with proposed changes (future phase). */
  | "pull_request"
  /** Publish content directly (future phase). */
  | "publish";

export type ConnectorProviderMeta = {
  id: ConnectorProviderId;
  name: string;
  /** One line shown on the connector card. */
  tagline: string;
  availability: "available" | "coming_soon";
  capabilities: ConnectorCapability[];
};

export const CONNECTOR_PROVIDERS: readonly ConnectorProviderMeta[] = [
  {
    id: "github",
    name: "GitHub",
    tagline: "Connect the repository behind your website",
    availability: "available",
    capabilities: ["source_read", "pull_request"],
  },
  {
    id: "wordpress",
    name: "WordPress",
    tagline: "Pages, posts and SEO metadata",
    availability: "coming_soon",
    capabilities: ["source_read", "publish"],
  },
  {
    id: "webflow",
    name: "Webflow",
    tagline: "CMS collections and page settings",
    availability: "coming_soon",
    capabilities: ["source_read", "publish"],
  },
  {
    id: "shopify",
    name: "Shopify",
    tagline: "Products, collections and storefront pages",
    availability: "coming_soon",
    capabilities: ["source_read"],
  },
  {
    id: "framer",
    name: "Framer",
    tagline: "Site pages and metadata",
    availability: "coming_soon",
    capabilities: ["source_read"],
  },
];

/** active = usable · suspended = paused by the account owner · revoked = access removed · error = last check failed */
export type ConnectionStatus = "active" | "suspended" | "revoked" | "error";

/** How Mellox confirmed the person who connected controls the external account. */
export type ConnectionVerification = "oauth" | "install_window";

export type ConnectionView = {
  id: string;
  provider: ConnectorProviderId;
  status: ConnectionStatus;
  accountLogin: string;
  accountType: string | null;
  accountAvatarUrl: string | null;
  /** Where the owner manages or uninstalls access on the provider. */
  manageUrl: string | null;
  /** GitHub: "all" repositories or a "selected" subset. */
  repositorySelection: "all" | "selected" | null;
  permissions: Record<string, string>;
  verification: ConnectionVerification;
  lastVerifiedAt: string | null;
  lastError: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  connectedAt: string;
};

export type SourceStatus = "active" | "access_lost";

/** What a read-only look at a repository found (never file contents). */
export type SourceInspection = {
  inspectedAt: string;
  branch: string;
  commitSha: string | null;
  /** Best guess from package.json / config files. */
  framework: string | null;
  frameworkEvidence: string | null;
  /** Discovery files present in the repository, by path. */
  discoveryFiles: { robots: string | null; sitemap: string | null; llms: string | null };
  /** Top-level entries (names only). */
  rootEntries: string[];
  truncated: boolean;
};

export type SourceView = {
  id: string;
  connectionId: string;
  provider: ConnectorProviderId;
  status: SourceStatus;
  externalId: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string | null;
  branch: string | null;
  htmlUrl: string | null;
  /** The website this source builds — links it to AI Visibility scans of that host. */
  siteUrl: string | null;
  inspection: SourceInspection | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  selectedAt: string;
  /** Evidence that this repository builds `siteUrl` (fixes require "verified"). */
  ownership: SourceOwnershipView;
  /** When an admin agreed to send this repository's code to the GEO coding agent's model. */
  agentConsentAt: string | null;
};

export type SourceOwnershipView = {
  status: OwnershipStatus;
  confidence: number | null;
  /** The host the evidence was collected for. */
  siteHost: string | null;
  commitSha: string | null;
  evidence: OwnershipEvidence[];
  hints: string[];
  checkedAt: string | null;
};

/** A repository the installation can access, as offered in the picker. */
export type RepositoryOption = {
  id: string;
  name: string;
  fullName: string;
  ownerLogin: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  description: string | null;
  homepage: string | null;
  pushedAt: string | null;
  archived: boolean;
};

export type ConnectorsOverview = {
  providers: readonly ConnectorProviderMeta[];
  /** Server configuration state per available provider (no secrets). */
  configured: Record<
    "github",
    {
      ready: boolean;
      installVerification: ConnectionVerification | "unavailable";
      issues: string[];
      diagnostic: GitHubDiagnostic;
    }
  >;
  connections: ConnectionView[];
  sources: SourceView[];
  /** Whether the caller may connect, select and disconnect (admin or owner). */
  canManage: boolean;
};

export const CONNECTOR_BROADCAST_CHANNEL = "mellox-connectors";
export type ConnectorBroadcast =
  | { type: "connected"; provider: ConnectorProviderId; connectionId: string }
  | { type: "error"; provider: ConnectorProviderId; message: string };
