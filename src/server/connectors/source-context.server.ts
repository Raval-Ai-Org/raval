// source-context.server.ts — the boundary between connectors and AI Visibility.
//
// AI Visibility scans websites over HTTP (src/server/geo). A connected source
// adds what HTTP can't see: which repository and framework build a site, and
// where its robots / sitemap / llms.txt are generated. Today this context is
// shown next to scan results; the GEO engine does not score source code yet.
// Fix pull requests are built in src/server/geo/fixes — nothing in this
// module writes to a repository.
import "server-only";
import type { UserSupabaseClient } from "@/integrations/supabase/client.user.server";
import { ownershipIsCurrent } from "@/lib/connectors/ownership";
import type { SourceView } from "@/lib/connectors/types";
import { presentSource, SOURCE_COLS, type SourceRow } from "./present";

export type SiteSourceContext = {
  source: SourceView | null;
  webflowSite: {
    siteId: string;
    name: string;
    domain: string | null;
    connectionId: string;
  } | null;
  wordpressSite: {
    siteUrl: string;
    name: string;
    connectionId: string;
  } | null;
  /** Capabilities available now vs. planned. */
  capabilities: { inspect: true; proposeChanges: boolean };
};

/** The connected source linked to `host` in this workspace, if any (RLS-scoped). */
export async function getSiteSourceContext(
  supabase: UserSupabaseClient,
  workspaceId: string,
  host: string,
): Promise<SiteSourceContext | null> {
  const normalized = host.toLowerCase().replace(/^www\./, "");
  const { data, error } = await supabase
    .from("workspace_sources")
    .select(SOURCE_COLS)
    .eq("workspace_id", workspaceId)
    .eq("site_host", normalized)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let webflowSite: SiteSourceContext["webflowSite"] = null;
  let wordpressSite: SiteSourceContext["wordpressSite"] = null;
  const webflowDb = supabase as unknown as { from: (table: string) => any };
  const { data: wf } = await webflowDb
    .from("webflow_sites")
    .select("site_id, site_name, domain, connection_id")
    .eq("workspace_id", workspaceId)
    .eq("selected", true)
    .eq("status", "active")
    .maybeSingle();
  if (wf?.domain && wf.domain.toLowerCase().replace(/^www\./, "") === normalized) {
    webflowSite = {
      siteId: wf.site_id,
      name: wf.site_name,
      domain: wf.domain ?? null,
      connectionId: wf.connection_id,
    };
  }
  const { data: wp } = await webflowDb
    .from("wordpress_sites")
    .select("site_url, site_name, connection_id")
    .eq("workspace_id", workspaceId)
    .eq("selected", true)
    .eq("status", "active")
    .maybeSingle();
  if (
    wp?.site_url &&
    new URL(wp.site_url).hostname.toLowerCase().replace(/^www\./, "") === normalized
  ) {
    wordpressSite = { siteUrl: wp.site_url, name: wp.site_name, connectionId: wp.connection_id };
  }
  if (error) return null;
  if (!data)
    return webflowSite || wordpressSite
      ? {
          source: null,
          webflowSite,
          wordpressSite,
          capabilities: { inspect: true, proposeChanges: false },
        }
      : null;
  const row = data as unknown as SourceRow;
  return {
    source: presentSource(row),
    webflowSite,
    wordpressSite,
    // Pull requests for AI Visibility fixes: src/server/geo/fixes/service.server.ts.
    // Changes are only proposed once the repository is proven to build this host.
    capabilities: {
      inspect: true,
      proposeChanges:
        row.status === "active" &&
        ownershipIsCurrent({
          status: row.ownership_status,
          checkedHost: row.ownership_site_host,
          checkedAt: row.ownership_checked_at,
          siteHost: normalized,
        }),
    },
  };
}
