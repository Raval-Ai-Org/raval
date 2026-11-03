"use client";

// Settings → Connectors: every app Mellox connects to (everything but social
// accounts and AI assistants), as real logos in a few small groups, like the
// connector directories in Claude and ChatGPT. A tile opens that app's own
// connector, so connecting here is exactly connecting anywhere else.
//
// Which provider sits behind an app (Composio or Mellox's own code) is the
// server's business and is never shown. `ConnectorsView` is presentational
// (rendered with sample data in /connections-lab).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLogo } from "@/components/brand/AppLogo";
import { Skeleton } from "@/components/ui/skeleton";
import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import { onConnectResult } from "@/lib/connectors/connect-window";
import { connectableApps } from "@/lib/integrations/catalog";
import { getIntegrations } from "@/lib/integrations.functions";
import { getCanvaConnection } from "@/lib/canva.functions";
import { getNotionConnection } from "@/lib/notion.functions";
import { getSlackConnection } from "@/lib/slack.functions";
import { getConnectors } from "@/lib/connectors.functions";
import { getWordPressConnection } from "@/lib/wordpress.functions";
import { getWebflowConnection } from "@/lib/webflow.functions";
import { getWixAvailability, getWixConnection } from "@/lib/wix.functions";
import { getGoogleConnection } from "@/lib/google-analytics.functions";
import { ConnectedApps } from "./ConnectedApps";
import { CanvaConnection } from "./CanvaConnection";
import { NotionConnection } from "./NotionConnection";
import { SlackConnection } from "./SlackConnection";
import { GitHubConnector } from "./GitHubConnector";
import { WordPressConnector } from "./WordPressConnector";
import { WebflowConnector } from "./WebflowConnector";
import { WixConnector } from "./WixConnector";
import { GoogleConnectCard } from "../analytics/GoogleConnectCard";
import {
  ConnectHero,
  LogoTile,
  OpenedView,
  slide,
  TileGroup,
  type TileTone,
} from "./ConnectorParts";

/** The groups, in order, and the apps in each. Ids are catalog ids. */
export const CONNECTOR_GROUPS = [
  { label: "Design and docs", ids: ["canva", "notion", "googledrive", "googlesheets"] },
  { label: "Email and ads", ids: ["gmail", "mailchimp", "googleads"] },
  { label: "Team and sales", ids: ["slack", "hubspot"] },
  { label: "Website", ids: ["google", "github", "wordpress", "webflow", "wix"] },
] as const;

export const CONNECTOR_NAMES: Record<string, string> = {
  canva: "Canva",
  notion: "Notion",
  googledrive: "Google Drive",
  googlesheets: "Google Sheets",
  gmail: "Gmail",
  mailchimp: "Mailchimp",
  googleads: "Google Ads",
  slack: "Slack",
  hubspot: "HubSpot",
  google: "Google Analytics",
  github: "GitHub",
  wordpress: "WordPress",
  webflow: "Webflow",
  wix: "Wix",
};

/** What the page knows about each connector. */
export type ConnectorsState = {
  /** Connectors that can be shown here, in any order. */
  available: string[];
  tones: Record<string, TileTone>;
};

/** Presentational: the hero, the groups, and one opened connector. */
export function ConnectorsView({
  state,
  open,
  onOpen,
  renderDetail,
}: {
  /** `null` while loading. */
  state: ConnectorsState | null;
  open: string | null;
  onOpen: (id: string | null) => void;
  renderDetail: (id: string) => ReactNode;
}) {
  const tone = (id: string): TileTone => state?.tones[id] ?? "off";
  const connected = (state?.available ?? []).filter((id) => tone(id) !== "off");
  const current = open && state?.available.includes(open) ? open : null;
  let index = 0;

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait" initial={false}>
        {current ? (
          <motion.div key={current} {...slide(1)}>
            <OpenedView backLabel="Connectors" onBack={() => onOpen(null)}>
              <div className="space-y-3">{renderDetail(current)}</div>
            </OpenedView>
          </motion.div>
        ) : (
          <motion.div key="grid" {...slide(-1)} className="ds-enter">
            {state ? (
              <ConnectHero
                title="Apps Mellox works with"
                count={connected.length}
                attention={connected.filter((id) => tone(id) === "attention").length}
                marks={connected.map((id) => ({
                  id,
                  node: <AppLogo app={id} name={CONNECTOR_NAMES[id] ?? id} size={44} />,
                }))}
              />
            ) : (
              <Skeleton className="h-[140px] rounded-[var(--ds-tile-radius,28px)]" />
            )}
            {state ? (
              CONNECTOR_GROUPS.map((group) => {
                const ids = group.ids.filter((id) => state.available.includes(id));
                if (!ids.length) return null;
                return (
                  <TileGroup key={group.label} label={group.label}>
                    {ids.map((id) => (
                      <LogoTile
                        key={id}
                        index={index++}
                        logo={<AppLogo app={id} name={CONNECTOR_NAMES[id] ?? id} size={48} />}
                        name={CONNECTOR_NAMES[id] ?? id}
                        tone={tone(id)}
                        onOpen={() => onOpen(id)}
                      />
                    ))}
                  </TileGroup>
                );
              })
            ) : (
              <div className="mt-7" aria-busy="true">
                <TileGroup>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <li key={i}>
                      <Skeleton className="aspect-square w-full rounded-[24px]" />
                    </li>
                  ))}
                </TileGroup>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

// ── Wiring ──────────────────────────────────────────────────────────────────

type Snapshot = ConnectorsState & { canvaDirect: boolean };

const settle = async <T,>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch {
    return null;
  }
};

/** "active" → on, a broken grant → attention, anything else → off. */
function toneOf(status: unknown): TileTone {
  if (status === "active" || status === "connected") return "on";
  if (
    status === "error" ||
    status === "reconnect_needed" ||
    status === "reconnect_required" ||
    status === "expired" ||
    status === "access_lost"
  )
    return "attention";
  return "off";
}

/** Composio apps shown as tiles here (social ones are in Social accounts). */
const COMPOSIO_TILES = [
  "gmail",
  "googledrive",
  "googlesheets",
  "googleads",
  "mailchimp",
  "hubspot",
];

async function readSnapshot(workspaceId: string): Promise<Snapshot> {
  const data = { data: { workspaceId } };
  const [apps, canva, notion, slack, sites, wp, wf, wixSetup, wix, google] = await Promise.all([
    settle(getIntegrations(data)),
    settle(getCanvaConnection(data)),
    settle(getNotionConnection(data)),
    settle(getSlackConnection(data)),
    settle(getConnectors(data)),
    settle(getWordPressConnection(data)),
    settle(getWebflowConnection(data)),
    settle(getWixAvailability(data)),
    settle(getWixConnection(data)),
    settle(getGoogleConnection(data)),
  ]);
  const tones: Record<string, TileTone> = {};
  for (const account of apps?.accounts ?? []) {
    if (tones[account.app] !== "on") tones[account.app] = toneOf(account.status);
  }
  const canvaDirect = (canva as { via?: string } | null)?.via === "direct";
  if (canva) tones.canva = toneOf(canva.status);
  tones.notion = toneOf((notion as { status?: unknown } | null)?.status);
  tones.slack = toneOf((slack as { connection?: { status?: unknown } } | null)?.connection?.status);
  const github = (sites?.connections ?? []).filter(
    (c: { provider: string; status: string }) => c.provider === "github" && c.status !== "revoked",
  );
  tones.github = github.length
    ? github.some((c) => c.status === "active")
      ? "on"
      : "attention"
    : "off";
  tones.wordpress = toneOf((wp as { status?: unknown } | null)?.status);
  tones.webflow = toneOf((wf as { status?: unknown } | null)?.status);
  tones.wix = toneOf((wix as { status?: unknown } | null)?.status);
  tones.google = toneOf(
    (google as { connection?: { status?: unknown } } | null)?.connection?.status,
  );

  const composio = apps?.enabled
    ? connectableApps({ testing: apps.testing }).map((app) => app.id)
    : [];
  // A Composio app shows when it can be connected here, or is already connected.
  const shows = (id: string) => composio.includes(id) || (tones[id] ?? "off") !== "off";
  const available = ["notion", "slack", "google", "github", "wordpress", "webflow"];
  if (canvaDirect || shows("canva")) available.push("canva");
  for (const id of COMPOSIO_TILES) if (shows(id)) available.push(id);
  if ((wixSetup as { available?: boolean } | null)?.available || tones.wix !== "off")
    available.push("wix");
  return { available, tones, canvaDirect };
}

export const connectorsKey = (workspaceId: string) => ["connectors-gallery", workspaceId] as const;

function detailFor(id: string, workspaceId: string, canvaDirect: boolean): ReactNode {
  switch (id) {
    case "canva":
      // Canva once: Composio unless this workspace still uses Mellox's own app.
      return canvaDirect ? <CanvaConnection /> : <ConnectedApps only="canva" />;
    case "notion":
      return <NotionConnection workspaceId={workspaceId} />;
    case "slack":
      return <SlackConnection workspaceId={workspaceId} />;
    case "google":
      return <GoogleConnectCard />;
    case "github":
      return <GitHubConnector workspaceId={workspaceId} />;
    case "wordpress":
      return <WordPressConnector workspaceId={workspaceId} />;
    case "webflow":
      return <WebflowConnector workspaceId={workspaceId} />;
    case "wix":
      return <WixConnector workspaceId={workspaceId} />;
    default:
      return <ConnectedApps only={id} />;
  }
}

export function ConnectorsGallery({
  workspaceId,
  initial,
}: {
  workspaceId: string;
  /** Open this connector straight away (deep links such as "google"). */
  initial?: string | null;
}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: connectorsKey(workspaceId),
    queryFn: () => readSnapshot(workspaceId),
    staleTime: 30_000,
  });
  const [open, setOpen] = useState<string | null>(initial ?? null);
  useEffect(() => setOpen(initial ?? null), [initial]);

  // Any connection that ends (in this tab or a sign-in window) re-reads the dots.
  useEffect(() => {
    const again = () => void qc.invalidateQueries({ queryKey: connectorsKey(workspaceId) });
    addAppEventListener("connections:changed", again);
    const off = onConnectResult(again);
    return () => {
      removeAppEventListener("connections:changed", again);
      off();
    };
  }, [qc, workspaceId]);

  const snapshot = query.data ?? null;
  const state = useMemo<ConnectorsState | null>(
    () => (snapshot ? { available: snapshot.available, tones: snapshot.tones } : null),
    [snapshot],
  );
  return (
    <ConnectorsView
      state={state}
      open={open}
      onOpen={(id) => {
        setOpen(id);
        // Back on the grid: show what changed while the connector was open.
        if (!id) void qc.invalidateQueries({ queryKey: connectorsKey(workspaceId) });
      }}
      renderDetail={(id) => detailFor(id, workspaceId, !!snapshot?.canvaDirect)}
    />
  );
}
