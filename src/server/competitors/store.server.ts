// store.server.ts — reads and writes for the competitor entity.
//
// Reads go through the caller's RLS-bound client, so a workspace can only ever
// see its own competitors even if a handler forgets a filter. Writes go
// through the service role, after the server fn has verified the caller's
// workspace role — the same split every other feature here uses.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertPublicUrl } from "@/server/safe-fetch";
import { webResearchAvailable } from "@/server/research/web-search.server";
import { normalizeCompetitorDomain } from "./service.server";
import type {
  CompetitorOverview,
  CompetitorProfile,
  CompetitorRelationship,
  CompetitorSourceLink,
  CompetitorSuggestion,
  CompetitorUpdateKind,
  CompetitorUpdateView,
  CompetitorView,
} from "@/lib/competitors/contracts";

type Db = SupabaseClient<Database>;

/** The generated Update shape, so a typo in a patch is a compile error. */
type CompetitorPatch = Database["public"]["Tables"]["workspace_competitors"]["Update"];

const COLUMNS =
  "id, workspace_id, name, domain, url, source, status, relationship, confidence, rationale, discovery_sources, profile, profile_status, profile_error, profile_updated_at, updates_checked_at, created_at, updated_at";

type Row = Record<string, unknown>;

function asSourceLinks(value: unknown): CompetitorSourceLink[] {
  return Array.isArray(value)
    ? value
        .map((entry): CompetitorSourceLink | null => {
          const row = entry as Record<string, unknown>;
          const url = typeof row?.url === "string" ? row.url : "";
          if (!url) return null;
          return {
            url,
            title: typeof row.title === "string" ? row.title : url,
            snippet: typeof row.snippet === "string" ? row.snippet : undefined,
          };
        })
        .filter((entry): entry is CompetitorSourceLink => entry !== null)
        .slice(0, 8)
    : [];
}

function presentCompetitor(
  row: Row,
  counts: { unread: number; lastUpdateAt: string | null },
): CompetitorView {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name ?? ""),
    domain: String(row.domain ?? ""),
    url: (row.url as string | null) ?? null,
    source: (row.source as CompetitorView["source"]) ?? "manual",
    status: (row.status as CompetitorView["status"]) ?? "suggested",
    relationship: (row.relationship as CompetitorRelationship) ?? "unknown",
    confidence: Number(row.confidence ?? 0),
    rationale: (row.rationale as string | null) ?? null,
    discoverySources: asSourceLinks(row.discovery_sources),
    profile: (row.profile as CompetitorProfile | null) ?? null,
    profileStatus: (row.profile_status as CompetitorView["profileStatus"]) ?? "pending",
    profileError: (row.profile_error as string | null) ?? null,
    profileUpdatedAt: (row.profile_updated_at as string | null) ?? null,
    updatesCheckedAt: (row.updates_checked_at as string | null) ?? null,
    unreadUpdates: counts.unread,
    lastUpdateAt: counts.lastUpdateAt,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function presentUpdate(
  row: Row,
  names: Map<string, { name: string; domain: string }>,
): CompetitorUpdateView {
  const competitorId = String(row.competitor_id);
  const competitor = names.get(competitorId);
  return {
    id: String(row.id),
    competitorId,
    competitorName: competitor?.name ?? "",
    competitorDomain: competitor?.domain ?? "",
    kind: (row.kind as CompetitorUpdateKind) ?? "content",
    title: String(row.title ?? ""),
    summary: (row.summary as string | null) ?? null,
    significance: row.significance === "major" ? "major" : "notable",
    sourceUrl: (row.source_url as string | null) ?? null,
    sourceTitle: (row.source_title as string | null) ?? null,
    publishedAt: (row.published_at as string | null) ?? null,
    detectedAt: String(row.detected_at),
    readAt: (row.read_at as string | null) ?? null,
  };
}

/** Everything the Competitors surface needs, in one round trip. */
export async function loadOverview(db: Db, workspaceId: string): Promise<CompetitorOverview> {
  const [competitorsResult, updatesResult] = await Promise.all([
    db
      .from("workspace_competitors")
      .select(COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("status", { ascending: true })
      .order("confidence", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("competitor_updates")
      .select(
        "id, competitor_id, kind, title, summary, significance, source_url, source_title, published_at, detected_at, read_at",
      )
      .eq("workspace_id", workspaceId)
      .order("detected_at", { ascending: false })
      .limit(120),
  ]);

  if (competitorsResult.error) throw new Error(competitorsResult.error.message);

  const rows = (competitorsResult.data ?? []) as unknown as Row[];
  const updateRows = (updatesResult.data ?? []) as unknown as Row[];

  const names = new Map(
    rows.map((row) => [
      String(row.id),
      { name: String(row.name ?? ""), domain: String(row.domain ?? "") },
    ]),
  );

  const perCompetitor = new Map<string, { unread: number; lastUpdateAt: string | null }>();
  for (const update of updateRows) {
    const id = String(update.competitor_id);
    const entry = perCompetitor.get(id) ?? { unread: 0, lastUpdateAt: null };
    if (!update.read_at) entry.unread += 1;
    if (!entry.lastUpdateAt) entry.lastUpdateAt = String(update.detected_at);
    perCompetitor.set(id, entry);
  }

  const all = rows.map((row) =>
    presentCompetitor(row, perCompetitor.get(String(row.id)) ?? { unread: 0, lastUpdateAt: null }),
  );
  const tracked = all.filter((competitor) => competitor.status === "tracked");
  const suggestions = all.filter((competitor) => competitor.status === "suggested");
  const updates = updateRows.map((row) => presentUpdate(row, names));

  const discovered = all
    .filter((competitor) => competitor.source === "discovered")
    .map((competitor) => competitor.createdAt)
    .sort();

  return {
    competitors: tracked,
    suggestions,
    updates,
    unreadUpdates: updates.filter((update) => !update.readAt).length,
    researchAvailable: webResearchAvailable(),
    lastDiscoveryAt: discovered.length ? discovered[discovered.length - 1] : null,
  };
}

export type UpsertInput = {
  workspaceId: string;
  userId: string | null;
  name: string;
  domain: string;
  url: string | null;
  source: CompetitorView["source"];
  status: CompetitorView["status"];
  relationship?: CompetitorRelationship;
  confidence?: number;
  rationale?: string | null;
  discoverySources?: CompetitorSourceLink[];
};

/**
 * Create or refresh a competitor. Identity is (workspace, domain), so the same
 * company arriving from discovery, a manual add and Brand DNA converges on one
 * row instead of three.
 *
 * A row the user already decided about is never silently re-opened: an ignored
 * competitor stays ignored when discovery finds it again, and a tracked one is
 * not demoted back to a suggestion.
 */
export async function upsertCompetitor(input: UpsertInput): Promise<CompetitorView | null> {
  const domain = normalizeCompetitorDomain(input.domain);
  if (!domain || !domain.includes(".")) return null;

  const { data: existing } = await supabaseAdmin
    .from("workspace_competitors")
    .select(COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .eq("domain", domain)
    .maybeSingle();

  if (existing) {
    const current = existing as unknown as Row;
    const currentStatus = String(current.status);
    // Only a user action moves a competitor's status. Discovery re-running is
    // not a user action.
    const nextStatus =
      input.source === "discovered" || currentStatus !== "suggested" ? currentStatus : input.status;
    const patch: CompetitorPatch = { status: nextStatus };
    if (!current.rationale && input.rationale) patch.rationale = input.rationale;
    if (input.relationship && current.relationship === "unknown") {
      patch.relationship = input.relationship;
    }
    if (input.confidence && Number(current.confidence ?? 0) < input.confidence) {
      patch.confidence = input.confidence;
    }
    if (input.discoverySources?.length && !asSourceLinks(current.discovery_sources).length) {
      patch.discovery_sources = input.discoverySources;
    }
    const { data, error } = await supabaseAdmin
      .from("workspace_competitors")
      .update(patch)
      .eq("id", String(current.id))
      .select(COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return presentCompetitor(data as unknown as Row, { unread: 0, lastUpdateAt: null });
  }

  let url = input.url;
  if (url) {
    try {
      url = assertPublicUrl(url).toString();
    } catch {
      url = `https://${domain}`;
    }
  }

  const { data, error } = await supabaseAdmin
    .from("workspace_competitors")
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.userId,
      name: (input.name || domain).slice(0, 200),
      domain,
      url: url ?? `https://${domain}`,
      source: input.source,
      status: input.status,
      relationship: input.relationship ?? "unknown",
      confidence: Math.min(1, Math.max(0, input.confidence ?? 0)),
      rationale: input.rationale ?? null,
      discovery_sources: input.discoverySources ?? [],
      // A newly tracked competitor is due immediately; a suggestion is not due
      // at all until someone accepts it, so it costs nothing to leave sitting.
      next_check_at: input.status === "tracked" ? new Date().toISOString() : null,
    })
    .select(COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return presentCompetitor(data as unknown as Row, { unread: 0, lastUpdateAt: null });
}

/** Save discovery output as suggestions. Returns what is now on the board. */
export async function saveSuggestions(args: {
  workspaceId: string;
  userId: string | null;
  suggestions: readonly CompetitorSuggestion[];
}): Promise<CompetitorView[]> {
  const saved: CompetitorView[] = [];
  for (const suggestion of args.suggestions) {
    try {
      const row = await upsertCompetitor({
        workspaceId: args.workspaceId,
        userId: args.userId,
        name: suggestion.name,
        domain: suggestion.domain,
        url: suggestion.url,
        source: "discovered",
        status: "suggested",
        relationship: suggestion.relationship,
        confidence: suggestion.confidence,
        rationale: suggestion.rationale || suggestion.whatTheyDo || null,
        discoverySources: suggestion.sources,
      });
      if (row) saved.push(row);
    } catch (error) {
      // One bad candidate must not lose the rest of a discovery run.
      console.error("[competitors] failed to save suggestion", suggestion.domain, error);
    }
  }
  return saved;
}

/** Track / ignore. Tracking makes a competitor due for research straight away. */
export async function setStatus(args: {
  workspaceId: string;
  competitorId: string;
  status: CompetitorView["status"];
}): Promise<void> {
  const patch: CompetitorPatch = { status: args.status };
  if (args.status === "tracked") {
    patch.next_check_at = new Date().toISOString();
  } else {
    // An ignored competitor must never be claimed again, and must release any
    // lease it is holding so a worker does not keep it.
    patch.next_check_at = null;
    patch.lease_until = null;
    patch.locked_by = null;
  }
  const { error } = await supabaseAdmin
    .from("workspace_competitors")
    .update(patch)
    .eq("id", args.competitorId)
    .eq("workspace_id", args.workspaceId);
  if (error) throw new Error(error.message);
}

/** Queue a fresh research pass for one competitor. */
export async function requestRefresh(args: {
  workspaceId: string;
  competitorId: string;
  full: boolean;
}): Promise<void> {
  const patch: CompetitorPatch = {
    next_check_at: new Date().toISOString(),
    attempt_count: 0,
    // A stuck lease from a crashed worker would otherwise block the claim
    // until it expires; the user asked for this now.
    lease_until: null,
    locked_by: null,
  };
  if (args.full) patch.profile_status = "pending";
  const { error } = await supabaseAdmin
    .from("workspace_competitors")
    .update(patch)
    .eq("id", args.competitorId)
    .eq("workspace_id", args.workspaceId)
    .eq("status", "tracked");
  if (error) throw new Error(error.message);
}

export async function markUpdatesRead(args: {
  workspaceId: string;
  competitorId?: string | null;
}): Promise<number> {
  let query = supabaseAdmin
    .from("competitor_updates")
    .update({ read_at: new Date().toISOString() })
    .eq("workspace_id", args.workspaceId)
    .is("read_at", null);
  if (args.competitorId) query = query.eq("competitor_id", args.competitorId);
  const { data, error } = await query.select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export async function deleteCompetitor(args: {
  workspaceId: string;
  competitorId: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("workspace_competitors")
    .delete()
    .eq("id", args.competitorId)
    .eq("workspace_id", args.workspaceId);
  if (error) throw new Error(error.message);
}

/** Domains this workspace already knows about — so discovery never re-proposes them. */
export async function knownDomains(db: Db, workspaceId: string): Promise<string[]> {
  const { data } = await db
    .from("workspace_competitors")
    .select("domain")
    .eq("workspace_id", workspaceId)
    .limit(200);
  return (data ?? []).map((row) => String(row.domain));
}
