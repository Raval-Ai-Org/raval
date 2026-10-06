import "server-only";
import type { AnyServerFn } from "@/server/server-fn";

import * as analytics from "./analytics";
import * as audience from "./audience";
import * as autopilot from "./autopilot";
import * as brain from "./brain";
import * as brandDna from "./brand-dna";
import * as campaignGeneration from "./campaign-generation";
import * as canva from "./canva";
import * as chatActions from "./chat-actions";
import * as coach from "./coach";
import * as competitorIntel from "./competitor-intel";
import * as competitors from "./competitors";
import * as competitorWatch from "./competitor-watch";
import * as connectors from "./connectors";
import * as content from "./content";
import * as experiments from "./experiments";
import * as geo from "./geo";
import * as geoAeoAudit from "./geo-aeo-audit";
import * as geoAgent from "./geo-agent";
import * as geoFixes from "./geo-fixes";
import * as googleAnalytics from "./google-analytics";
import * as insights from "./insights";
import * as links from "./links";
import * as mcp from "./mcp";
import * as memory from "./memory";
import * as notion from "./notion";
import * as schedules from "./schedules";
import * as slack from "./slack";
import * as sitePublishing from "./site-publishing";
import * as stories from "./stories";
import * as strategy from "./strategy";
import * as trackedPrompts from "./tracked-prompts";
import * as workspaces from "./workspaces";
import * as webflow from "./webflow";
import * as wordpress from "./wordpress";

// Registry the /api/rpc/[...fn] route dispatches against. Keys mirror the paths
// the client stubs in src/lib/*.functions.ts were generated with.
const MODULES: Record<string, Record<string, unknown>> = {
  analytics,
  audience,
  canva,
  autopilot,
  brain,
  "brand-dna": brandDna,
  "campaign-generation": campaignGeneration,
  "chat-actions": chatActions,
  coach,
  "competitor-intel": competitorIntel,
  competitors,
  "competitor-watch": competitorWatch,
  connectors,
  content,
  experiments,
  geo,
  "geo-aeo-audit": geoAeoAudit,
  "geo-agent": geoAgent,
  "geo-fixes": geoFixes,
  "google-analytics": googleAnalytics,
  insights,
  links,
  mcp,
  memory,
  notion,
  schedules,
  slack,
  "site-publishing": sitePublishing,
  stories,
  strategy,
  "tracked-prompts": trackedPrompts,
  workspaces,
  webflow,
  wordpress,
};

function isServerFn(value: unknown): value is AnyServerFn {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __isServerFn?: boolean }).__isServerFn === true
  );
}

export function resolveServerFn(moduleName: string, fnName: string): AnyServerFn | undefined {
  const mod = MODULES[moduleName];
  if (!mod) return undefined;
  const candidate = mod[fnName];
  return isServerFn(candidate) ? candidate : undefined;
}
