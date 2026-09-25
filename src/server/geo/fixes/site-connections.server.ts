import "server-only";
// site-connections.server.ts — what each platform (GitHub, WordPress, Webflow)
// can do for one scanned website, for the connection picker in AI Visibility.
//
// "Serves the site" comes only from resolveSite (a connection proven against
// the live page or ownership evidence); everything else is described plainly
// so the person knows the one next step. No tokens or raw rows leave here.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SiteConnections, SiteConnectionTile, SiteProviderId } from "@/lib/geo/fix-contracts";
import { getGitHubConfigCheck } from "@/server/connectors/github/config.server";
import { resolveSite } from "@/server/sites/resolve.server";
import { FixWorkflowError, type FixContext } from "./service.server";

const db = supabaseAdmin as unknown as { from: (table: string) => any };

const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

export async function scanHost(ctx: FixContext, scanId: string): Promise<string> {
  const { data } = await ctx.supabase
    .from("geo_scans")
    .select("host")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", scanId)
    .maybeSingle();
  if (!data) throw new FixWorkflowError("Scan not found", 404);
  return data.host;
}

export async function getSiteConnections(ctx: FixContext, host: string): Promise<SiteConnections> {
  const ws = ctx.workspaceId;
  const [resolution, conns, wpSites, wfSites] = await Promise.all([
    resolveSite(ws, host, { live: true }),
    db
      .from("workspace_connections")
      .select("provider, status")
      .eq("workspace_id", ws)
      .in("provider", ["github", "wordpress", "webflow"])
      .neq("status", "revoked"),
    db
      .from("wordpress_sites")
      .select("site_url, site_name, selected, status")
      .eq("workspace_id", ws),
    db.from("webflow_sites").select("site_name, domain, selected, status").eq("workspace_id", ws),
  ]);
  const connected = (p: SiteProviderId) =>
    ((conns.data ?? []) as { provider: string; status: string }[]).some(
      (c) => c.provider === p && c.status === "active",
    );
  const detected: SiteProviderId | null =
    resolution.fingerprint?.platform === "wordpress" ||
    resolution.fingerprint?.platform === "webflow"
      ? resolution.fingerprint.platform
      : null;
  const githubReady = getGitHubConfigCheck().ok;

  const tile = (provider: SiteProviderId): SiteConnectionTile => {
    const candidate = resolution.candidates.find((c) => c.provider === provider) ?? null;
    const base = { provider, detected: detected === provider };
    if (candidate?.verified)
      return {
        ...base,
        state: "serves_site",
        detail: candidate.proof,
        siteName:
          candidate.provider === "github"
            ? candidate.fullName
            : candidate.provider === "webflow"
              ? candidate.siteName
              : hostOf(candidate.siteUrl),
      };
    if (candidate)
      return {
        ...base,
        state: "needs_check",
        detail: candidate.proof,
        siteName: candidate.provider === "github" ? candidate.fullName : null,
      };
    if (provider === "github" && !githubReady)
      return {
        ...base,
        state: "unavailable",
        detail: "Not available on this server yet.",
        siteName: null,
      };
    if (connected(provider)) {
      if (provider === "github")
        return {
          ...base,
          state: "connected_other",
          detail: `Connected. Choose the repository that builds ${host}.`,
          siteName: null,
        };
      if (provider === "wordpress") {
        const site = (
          (wpSites.data ?? []) as {
            site_url: string;
            site_name: string | null;
            selected: boolean;
          }[]
        ).find((s) => s.selected);
        return {
          ...base,
          state: "connected_other",
          detail: site
            ? `Connected to ${hostOf(site.site_url)}, not ${host}.`
            : "Connected. Choose your site.",
          siteName: site ? hostOf(site.site_url) : null,
        };
      }
      const site = (
        (wfSites.data ?? []) as {
          site_name: string | null;
          domain: string | null;
          selected: boolean;
        }[]
      ).find((s) => s.selected);
      return {
        ...base,
        state: "connected_other",
        detail: site
          ? `Connected to ${site.domain ?? site.site_name}, not ${host}.`
          : "Connected. Choose your site.",
        siteName: site?.site_name ?? null,
      };
    }
    return {
      ...base,
      state: "not_connected",
      detail:
        provider === "github"
          ? "For sites built from code. Fixes arrive as a pull request."
          : provider === "wordpress"
            ? "Fixes go live on your site after you approve them."
            : "Fixes go live on your site after you approve them.",
      siteName: null,
    };
  };

  const active = resolution.binding?.verified ? resolution.binding.provider : null;
  const order: SiteProviderId[] = ["github", "wordpress", "webflow"];
  // The platform that serves (or is detected on) the site comes first.
  const first = active ?? detected;
  const tiles = (first ? [first, ...order.filter((p) => p !== first)] : order).map(tile);
  return { host, active, detected, tiles, canManage: ctx.canManage };
}
