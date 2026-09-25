// sources.server.ts — what an experiment is built on: the GitHub repository
// proven to build the site, and the workspace's Search Console / GA4 sources.
// Reads the caller's workspace only (the verified id); rows are mapped to
// names and ids, never tokens.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Tables } from "@/integrations/supabase/types";
import { ownershipIsCurrent } from "@/lib/connectors/ownership";
import type { SetupState } from "@/lib/experiments/contracts";
import {
  CONNECTION_COLS,
  SOURCE_COLS,
  type ConnectionRow,
  type SourceRow,
} from "@/server/connectors/present";
import { ExperimentError } from "./core.server";

export type AnalyticsSource = Tables<"analytics_sources">;

/** Frameworks whose route files `findTemplateFile` understands. */
export const SUPPORTED_FRAMEWORKS = ["Next.js", "Astro", "Nuxt", "SvelteKit", "Remix"];

export function normHost(host: string | null | undefined): string {
  return (host ?? "").toLowerCase().replace(/^www\./, "");
}

/** Does a Search Console property (sc-domain:x or https://x/) cover `host`? */
export function gscCoversHost(siteUrl: string, host: string): boolean {
  const h = normHost(host);
  if (siteUrl.startsWith("sc-domain:")) {
    const domain = normHost(siteUrl.slice("sc-domain:".length));
    return h === domain || h.endsWith(`.${domain}`);
  }
  try {
    return normHost(new URL(siteUrl).hostname) === h;
  } catch {
    return false;
  }
}

export type SiteSources = {
  source: SourceRow | null;
  connection: ConnectionRow | null;
  gsc: AnalyticsSource | null;
  ga4: AnalyticsSource | null;
};

export async function loadSiteSources(workspaceId: string): Promise<SiteSources> {
  const [sources, connections, analytics] = await Promise.all([
    supabaseAdmin
      .from("workspace_sources")
      .select(SOURCE_COLS)
      .eq("workspace_id", workspaceId)
      .eq("provider", "github")
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("workspace_connections")
      .select(CONNECTION_COLS)
      .eq("workspace_id", workspaceId)
      .eq("provider", "github"),
    supabaseAdmin.from("analytics_sources").select("*").eq("workspace_id", workspaceId),
  ]);
  if (sources.error) throw new Error(sources.error.message);
  if (connections.error) throw new Error(connections.error.message);
  if (analytics.error) throw new Error(analytics.error.message);
  const all = (sources.data ?? []) as unknown as SourceRow[];
  const conns = (connections.data ?? []) as unknown as ConnectionRow[];
  // Prefer a repository proven to build its site, then any active one.
  const source =
    all.find((s) => s.status === "active" && s.site_host && isOwnershipVerified(s)) ??
    all.find((s) => s.status === "active" && s.site_host) ??
    all[0] ??
    null;
  const connection = source ? (conns.find((c) => c.id === source.connection_id) ?? null) : null;
  const rows = (analytics.data ?? []) as AnalyticsSource[];
  return {
    source,
    connection,
    gsc: rows.find((r) => r.kind === "gsc_site") ?? null,
    ga4: rows.find((r) => r.kind === "ga4_property") ?? null,
  };
}

export function isOwnershipVerified(source: SourceRow): boolean {
  if (!source.site_host) return false;
  return ownershipIsCurrent({
    status: source.ownership_status,
    checkedHost: source.ownership_site_host,
    checkedAt: source.ownership_checked_at,
    siteHost: source.site_host,
  });
}

export function setupState(s: SiteSources): SetupState {
  const framework = s.source?.inspection?.framework ?? null;
  // The route layout (e.g. App vs Pages Router) is checked per group against the tree.
  const fw = framework ? SUPPORTED_FRAMEWORKS.includes(framework) : true;
  const blockers: SetupState["blockers"] = [];
  const githubUsable =
    !!s.source &&
    s.source.status === "active" &&
    !!s.connection &&
    !["revoked", "suspended"].includes(s.connection.status);
  if (!s.source) {
    blockers.push({
      code: "no_repository",
      message: "Connect the GitHub repository that builds your website.",
      action: "connect_github",
    });
  } else if (!githubUsable) {
    blockers.push({
      code: "repository_access",
      message: `Mellox can't reach ${s.source.full_name} right now. Reconnect GitHub.`,
      action: "connect_github",
    });
  } else if (!s.source.site_host) {
    blockers.push({
      code: "no_site_link",
      message: `Link ${s.source.full_name} to your website first.`,
      action: "verify_repo",
    });
  } else if (!isOwnershipVerified(s.source)) {
    blockers.push({
      code: "ownership",
      message: `Verify that ${s.source.full_name} builds ${s.source.site_host}.`,
      action: "verify_repo",
    });
  }
  if (s.source && framework && !fw) {
    blockers.push({
      code: "framework",
      message: `${framework} sites aren't supported yet. Experiments work with Next.js, Astro, Nuxt, SvelteKit and Remix sites.`,
      action: "none",
    });
  }
  if (!s.gsc) {
    blockers.push({
      code: "no_search_console",
      message: "Connect Google Search Console so Mellox can measure your pages.",
      action: "connect_google",
    });
  } else if (s.source?.site_host && !gscCoversHost(s.gsc.external_id, s.source.site_host)) {
    blockers.push({
      code: "search_console_site",
      message: `The connected Search Console property doesn't cover ${s.source.site_host}.`,
      action: "connect_google",
    });
  } else if (s.gsc.status === "access_lost") {
    blockers.push({
      code: "search_console_access",
      message: "Google Search Console access was lost. Reconnect Google.",
      action: "connect_google",
    });
  }
  return {
    github: {
      connected: !!s.source,
      sourceId: s.source?.id ?? null,
      repository: s.source?.full_name ?? null,
      siteHost: s.source?.site_host ?? null,
      ownershipVerified: s.source ? isOwnershipVerified(s.source) : false,
      framework,
      supportedFramework: fw,
    },
    gsc: {
      connected: !!s.gsc,
      site: s.gsc?.external_id ?? null,
      status: s.gsc?.status ?? null,
    },
    ga4: {
      connected: !!s.ga4,
      property: s.ga4?.display_name ?? null,
      currency: s.ga4?.currency ?? null,
    },
    blockers,
  };
}

/** Everything a write to the repository needs, or a plain reason it can't happen. */
export function requireWritableSource(s: SiteSources): {
  source: SourceRow;
  connection: ConnectionRow;
  host: string;
  baseBranch: string;
} {
  const blockers = setupState(s).blockers.filter((b) =>
    ["no_repository", "repository_access", "no_site_link", "ownership", "framework"].includes(
      b.code,
    ),
  );
  if (blockers.length || !s.source || !s.connection || !s.source.site_host) {
    throw new ExperimentError(
      blockers[0]?.message ?? "Connect your website's repository first.",
      409,
    );
  }
  return {
    source: s.source,
    connection: s.connection,
    host: normHost(s.source.site_host),
    baseBranch: s.source.branch || s.source.default_branch || "main",
  };
}

export function requireGsc(s: SiteSources, host: string): AnalyticsSource {
  if (!s.gsc) throw new ExperimentError("Connect Google Search Console first.", 409);
  if (!gscCoversHost(s.gsc.external_id, host)) {
    throw new ExperimentError(`The Search Console property doesn't cover ${host}.`, 409);
  }
  if (s.gsc.status === "access_lost") {
    throw new ExperimentError("Google Search Console access was lost. Reconnect Google.", 409);
  }
  return s.gsc;
}
