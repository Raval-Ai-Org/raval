import "server-only";
import type { AnyServerFn } from "@/server/server-fn";

import * as analytics from "./analytics";
import * as brandDna from "./brand-dna";
import * as campaignGeneration from "./campaign-generation";
import * as coach from "./coach";
import * as competitorIntel from "./competitor-intel";
import * as competitorWatch from "./competitor-watch";
import * as connectors from "./connectors";
import * as content from "./content";
import * as geo from "./geo";
import * as geoAeoAudit from "./geo-aeo-audit";
import * as geoAgent from "./geo-agent";
import * as geoFixes from "./geo-fixes";
import * as insights from "./insights";
import * as schedules from "./schedules";
import * as workspaces from "./workspaces";

// Registry the /api/rpc/[...fn] route dispatches against. Keys mirror the paths
// the client stubs in src/lib/*.functions.ts were generated with.
const MODULES: Record<string, Record<string, unknown>> = {
  analytics,
  "brand-dna": brandDna,
  "campaign-generation": campaignGeneration,
  coach,
  "competitor-intel": competitorIntel,
  "competitor-watch": competitorWatch,
  connectors,
  content,
  geo,
  "geo-aeo-audit": geoAeoAudit,
  "geo-agent": geoAgent,
  "geo-fixes": geoFixes,
  insights,
  schedules,
  workspaces,
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
