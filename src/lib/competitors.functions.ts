"use client";
// competitors.functions.ts — browser stubs for the Competitors surface.
// Types are re-exported so components never import a server module.
import { serverFn } from "@/lib/rpc-client";
import type * as Handlers from "@/server/fns/competitors";

export type {
  CompetitorOverview,
  CompetitorView,
  CompetitorUpdateView,
  CompetitorProfile,
  CompetitorSuggestion,
  CompetitorRelationship,
  CompetitorStatus,
  CompetitorUpdateKind,
  CompetitorSourceLink,
} from "@/lib/competitors/contracts";
export { UPDATE_KIND_LABELS, RELATIONSHIP_LABELS } from "@/lib/competitors/contracts";

export const getCompetitorOverview = serverFn<typeof Handlers.getCompetitorOverview>(
  "competitors/getCompetitorOverview",
);
export const discoverCompetitors = serverFn<typeof Handlers.discoverCompetitors>(
  "competitors/discoverCompetitors",
);
export const bootstrapCompetitors = serverFn<typeof Handlers.bootstrapCompetitors>(
  "competitors/bootstrapCompetitors",
);
export const addCompetitor = serverFn<typeof Handlers.addCompetitor>("competitors/addCompetitor");
export const setCompetitorStatus = serverFn<typeof Handlers.setCompetitorStatus>(
  "competitors/setCompetitorStatus",
);
export const trackCompetitors = serverFn<typeof Handlers.trackCompetitors>(
  "competitors/trackCompetitors",
);
export const refreshCompetitor = serverFn<typeof Handlers.refreshCompetitor>(
  "competitors/refreshCompetitor",
);
export const markCompetitorUpdatesRead = serverFn<typeof Handlers.markCompetitorUpdatesRead>(
  "competitors/markCompetitorUpdatesRead",
);
export const removeCompetitor = serverFn<typeof Handlers.removeCompetitor>(
  "competitors/removeCompetitor",
);
