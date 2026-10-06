"use client";

// Development-only visual check for Settings → Connections, Website and AI
// assistants, with sample data. Nothing here talks to a server.
import { useState } from "react";
import { Building2, Clock, Database, ExternalLink, RefreshCw, User } from "@/components/icons";
import { SlackMark, NotionMark } from "@/components/brand/AppMarks";
import { CanvaMark } from "@/components/brand/CanvaMark";
import { GroupLabel } from "@/components/app/surface/SurfaceLayout";
import { Button } from "@/components/ui/button";
import { CONNECTOR_PROVIDERS, type ConnectorsOverview } from "@/lib/connectors/types";
import { cn } from "@/lib/utils";
import { ConnectionCard, ConnectionFact, ConnectionSkeleton } from "./ConnectionCard";
import { GitHubView } from "./GitHubConnector";
import { McpScreen, type McpActivityItem, type McpTool } from "./McpScreen";
import { WebflowView, type WebflowConnection } from "./WebflowConnector";
import { WordPressView, type WordPressConnection } from "./WordPressConnector";

const SCENES = ["apps", "website", "website-empty", "assistants", "assistants-viewer"] as const;
type Scene = (typeof SCENES)[number];

const WS = "00000000-0000-4000-8000-000000000001";
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const TOOLS: McpTool[] = [
  ...[
    "List content",
    "Get a post",
    "List the calendar",
    "Get analytics",
    "Get Brand DNA",
    "Get AI Visibility score",
    "List competitors",
    "Suggest post ideas",
  ].map((title) => ({ title, write: false })),
  ...[
    "Create a post",
    "Edit a post",
    "Approve a post",
    "Schedule a post",
    "Publish a post",
    "Start a website scan",
  ].map((title) => ({ title, write: true })),
];

const ACTIVITY: McpActivityItem[] = [
  { id: "1", title: "List the calendar", ok: true, createdAt: ago(4) },
  { id: "2", title: "Create a post", ok: true, createdAt: ago(38) },
  { id: "3", title: "Schedule a post", ok: false, createdAt: ago(190) },
  { id: "4", title: "Get analytics", ok: true, createdAt: ago(60 * 30) },
];

const WEBFLOW = {
  connectionId: WS,
  status: "active",
  accountEmail: "sam@northwind.co",
  selectedSite: { id: "s1", name: "Northwind", domain: "northwind.co", selected: true },
  sites: [
    { id: "s1", name: "Northwind", domain: "northwind.co", selected: true },
    { id: "s2", name: "Northwind Blog", domain: "blog.northwind.co", selected: false },
    { id: "s3", name: "Launch page", domain: null, selected: false },
  ],
} as unknown as WebflowConnection;

const WORDPRESS = {
  connectionId: WS,
  status: "active",
  authType: "wordpress_com_oauth",
  accountName: "Sam Rivera",
  username: "sam",
  siteUrl: "https://northwind.co",
  siteName: "Northwind",
  lastVerifiedAt: ago(90),
  selectedSite: {
    id: "w1",
    siteId: "w1",
    name: "Northwind",
    url: "https://northwind.co",
    selected: true,
  },
  sites: [
    {
      id: "w1",
      siteId: "w1",
      name: "Northwind",
      url: "https://northwind.co",
      selected: true,
      status: "active",
    },
    {
      id: "w2",
      siteId: "w2",
      name: "Northwind Journal",
      url: "https://journal.northwind.co",
      selected: false,
      status: "active",
    },
  ],
} as unknown as WordPressConnection;

const GITHUB_EMPTY: ConnectorsOverview = {
  providers: CONNECTOR_PROVIDERS,
  configured: {
    github: { ready: true, installVerification: "oauth", issues: [] },
    wordpress: { ready: true, installVerification: "unavailable", issues: [] },
  },
  connections: [],
  sources: [],
  canManage: true,
};

const GITHUB: ConnectorsOverview = {
  ...GITHUB_EMPTY,
  connections: [
    {
      id: "c1",
      provider: "github",
      status: "active",
      accountLogin: "northwind",
      accountType: "Organization",
      accountAvatarUrl: null,
      manageUrl: "https://github.com/settings/installations",
      repositorySelection: "selected",
      permissions: { contents: "write", pull_requests: "write", checks: "read", statuses: "read" },
      verification: "oauth",
      lastVerifiedAt: ago(180),
      lastError: null,
      revokedAt: null,
      revokedReason: null,
      connectedAt: ago(60 * 24 * 12),
    },
  ],
  sources: [
    {
      id: "r1",
      connectionId: "c1",
      provider: "github",
      status: "active",
      externalId: "101",
      name: "website",
      fullName: "northwind/website",
      private: true,
      defaultBranch: "main",
      branch: "main",
      htmlUrl: "https://github.com/northwind/website",
      siteUrl: "https://northwind.co",
      inspection: {
        inspectedAt: ago(200),
        branch: "main",
        commitSha: "4f2c9a1d",
        framework: "Next.js",
        frameworkEvidence: "package.json",
        discoveryFiles: { robots: "public/robots.txt", sitemap: "app/sitemap.ts", llms: null },
        rootEntries: [],
        truncated: false,
      },
      lastSyncedAt: ago(200),
      lastError: null,
      selectedAt: ago(60 * 24 * 12),
      ownership: {
        status: "verified",
        confidence: 0.92,
        siteHost: "northwind.co",
        commitSha: "4f2c9a1d",
        evidence: [],
        hints: [],
        checkedAt: ago(200),
      },
      agentConsentAt: null,
    },
  ],
};

function Website({ empty }: { empty: boolean }) {
  const [overview, setOverview] = useState(empty ? GITHUB_EMPTY : GITHUB);
  const noop = () => {};
  return (
    <div className="space-y-3">
      <GitHubView
        workspaceId={WS}
        overview={overview}
        onOverviewChange={(update) => setOverview(update)}
        busy={null}
        installing={false}
        refreshing={false}
        onInstall={noop}
        onRefresh={noop}
        onVerify={noop}
        onDisconnect={noop}
      />
      <WebflowView
        connection={empty ? null : WEBFLOW}
        busy={false}
        onConnect={noop}
        onRefresh={noop}
        onSelect={noop}
        onDisconnect={noop}
      />
      <WordPressView
        connection={empty ? null : WORDPRESS}
        busy={false}
        onConnectCom={noop}
        onConnectSelfHosted={async () => false}
        onRefresh={noop}
        onSelectSite={noop}
        onDisconnect={noop}
      />
      <ConnectionSkeleton label="Loading example" />
    </div>
  );
}

function Apps() {
  const [slackOpen, setSlackOpen] = useState(false);
  return (
    <div className="space-y-3">
      <ConnectionCard
        label="Canva connection"
        logo={<CanvaMark />}
        name="Canva"
        description="Edit your images and carousels in Canva"
        status={{ tone: "off", text: "Not connected" }}
        actions={
          <Button size="sm" variant="outline">
            Connect
          </Button>
        }
      />
      <ConnectionCard
        label="Notion connection"
        logo={<NotionMark />}
        name="Notion"
        description="Your content calendar, in Notion too"
        status={{ tone: "connected", text: "Connected" }}
        facts={
          <>
            <ConnectionFact icon={User}>Northwind HQ</ConnectionFact>
            <ConnectionFact icon={Database}>Mellox Content Calendar</ConnectionFact>
            <ConnectionFact icon={Clock}>Synced 12 min ago</ConnectionFact>
          </>
        }
        actions={
          <>
            <Button size="sm" variant="outline">
              <RefreshCw className="size-3.5" /> Sync
            </Button>
            <Button size="sm" variant="outline">
              Open <ExternalLink className="size-3.5" />
            </Button>
          </>
        }
      />
      <ConnectionCard
        label="Slack connection"
        logo={<SlackMark />}
        name="Slack"
        description="Approvals, a daily brief and answers in Slack"
        status={{ tone: "attention", text: "Reconnect needed" }}
        facts={
          <>
            <ConnectionFact icon={Building2}>Northwind</ConnectionFact>
            <ConnectionFact tone="warning">Choose a channel</ConnectionFact>
          </>
        }
        actions={
          <Button size="sm" variant="outline" onClick={() => setSlackOpen((v) => !v)}>
            {slackOpen ? "Close" : "Set up"}
          </Button>
        }
        note="Ask an owner or admin of this brand to connect Slack."
        error={slackOpen ? "Slack could not do that." : null}
      >
        {slackOpen && (
          <p className="text-[13px] text-muted-foreground">The setup steps open here.</p>
        )}
      </ConnectionCard>
    </div>
  );
}

function Assistants({ viewer }: { viewer: boolean }) {
  const [state, setState] = useState({ enabled: !viewer, allowWrites: false });
  return (
    <McpScreen
      enabled={state.enabled}
      allowWrites={state.allowWrites}
      canManage={!viewer}
      saving={false}
      serverUrl="https://app.mellox.ai/api/mcp"
      tools={TOOLS}
      activity={viewer ? undefined : ACTIVITY}
      onChange={setState}
      onCopy={async () => true}
    />
  );
}

export function ConnectionsLab() {
  const [scene, setScene] = useState<Scene>("website");
  return (
    <div data-mellox-app className="min-h-dvh bg-background text-foreground">
      <nav className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b border-border/60 bg-background px-4 py-2">
        <span className="mr-2 text-[12px] font-medium text-muted-foreground">Connections lab</span>
        {SCENES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScene(s)}
            className={cn(
              "h-7 rounded-full px-3 text-[12px] font-medium",
              s === scene
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-foreground/80",
            )}
          >
            {s}
          </button>
        ))}
        <button
          type="button"
          onClick={() => document.documentElement.classList.toggle("dark")}
          className="ml-auto h-7 rounded-full bg-secondary px-3 text-[12px] font-medium text-foreground/80"
        >
          theme
        </button>
      </nav>
      <main key={scene} className="mx-auto w-full max-w-[760px] px-4 pb-16 pt-6 sm:px-7">
        <GroupLabel>{scene}</GroupLabel>
        {scene === "apps" && <Apps />}
        {scene === "website" && <Website empty={false} />}
        {scene === "website-empty" && <Website empty />}
        {scene === "assistants" && <Assistants viewer={false} />}
        {scene === "assistants-viewer" && <Assistants viewer />}
      </main>
    </div>
  );
}
