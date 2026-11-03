"use client";

// Channels: every account and app a brand connects, in one place (sidebar →
// Grow → Channels). Each section reuses the connector that already owns it,
// so connecting here is exactly connecting anywhere else; which provider sits
// behind a social network is decided on the server and never shown.
import { BarChart, Globe, Megaphone, Sparkles } from "@/components/icons";
import { SurfaceLayout, SurfacePage, type SurfaceNavItem } from "@/components/app/surface/SurfaceLayout";
import { SocialAccountsSection } from "@/components/app/SocialAccountsSection";
import { CanvaConnection } from "@/components/app/connectors/CanvaConnection";
import { NotionConnection } from "@/components/app/connectors/NotionConnection";
import { SlackConnection } from "@/components/app/connectors/SlackConnection";
import { ConnectedApps } from "@/components/app/connectors/ConnectedApps";
import { GitHubConnector } from "@/components/app/connectors/GitHubConnector";
import { WebflowConnector } from "@/components/app/connectors/WebflowConnector";
import { WixConnector } from "@/components/app/connectors/WixConnector";
import { WordPressConnector } from "@/components/app/connectors/WordPressConnector";
import { GoogleConnectCard } from "@/components/app/analytics/GoogleConnectCard";
import { CHANNEL_SECTIONS, type ChannelSection } from "@/lib/channels/sections";

const ICONS = { social: Megaphone, apps: Sparkles, website: Globe, analytics: BarChart } as const;

const NAV: SurfaceNavItem<ChannelSection>[] = CHANNEL_SECTIONS.map((s) => ({
  id: s.id,
  label: s.label,
  icon: ICONS[s.id],
}));

export function ChannelsPanel({
  workspaceId,
  section,
  onSection,
}: {
  workspaceId: string;
  section: ChannelSection;
  onSection: (next: ChannelSection) => void;
}) {
  const meta = CHANNEL_SECTIONS.find((s) => s.id === section)!;
  return (
    <SurfaceLayout label="Channels" items={NAV} value={section} onChange={onSection}>
      <div key={section} className="ds-enter">
        <SurfacePage title={meta.label} subtitle={meta.subtitle} width="wide">
          {section === "social" && <SocialAccountsSection variant="channels" />}
          {section === "apps" && (
            <div className="space-y-6">
              <ConnectedApps grouped exclude={["social", "community"]} />
              <div className="space-y-3">
                <CanvaConnection />
                <NotionConnection workspaceId={workspaceId} />
                <SlackConnection workspaceId={workspaceId} />
              </div>
            </div>
          )}
          {section === "website" && (
            <div className="space-y-3">
              <GitHubConnector workspaceId={workspaceId} />
              <WordPressConnector workspaceId={workspaceId} />
              <WebflowConnector workspaceId={workspaceId} />
              <WixConnector workspaceId={workspaceId} />
            </div>
          )}
          {section === "analytics" && <GoogleConnectCard />}
        </SurfacePage>
      </div>
    </SurfaceLayout>
  );
}
