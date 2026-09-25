import "server-only";
// resolve.server.ts — which connected platform builds a scanned website.
//
// One answer per (workspace, host), used by every path that changes a site:
// GEO fixes, "Fix all", blog setup and article publishing.
//
//   github     a linked repository whose ownership check is current for the host
//              (ADR-0013: deployment/Pages evidence or live content in source)
//   wordpress  the connected site's URL — as reported by WordPress itself, or
//              WordPress.com's API for OAuth sites — has this host, and the live
//              page is served by WordPress
//   webflow    the selected site's domains — as reported by Webflow's API — include
//              this host, and the live page carries data-wf-site = that site id
//
// A live page that contradicts the connection (another platform, another
// Webflow site) blocks every change: Mellox never edits a site it can't prove.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fingerprintPage, hostOf, type PageFingerprint } from "@/lib/sites/fingerprint";
import { safeFetch } from "@/server/safe-fetch";
import { ownershipIsCurrent, type OwnershipStatus } from "@/lib/connectors/ownership";
import type { SiteBindingView } from "@/lib/geo/fix-contracts";

export type SiteProvider = "github" | "wordpress" | "webflow";

/** Where WordPress head tags (title, description, canonical, schema) can be written. */
export type WordPressSeoBackend = "mellox" | "rankmath" | "jetpack" | "none";

type BindingBase = {
  host: string;
  connectionId: string;
  /** Proven to serve this host (see header). Changes require true. */
  verified: boolean;
  proof: string;
};

export type SiteBinding =
  | (BindingBase & {
      provider: "github";
      sourceId: string;
      fullName: string;
    })
  | (BindingBase & {
      provider: "wordpress";
      siteUrl: string;
      authType: "application_password" | "wordpress_com_oauth";
      seo: WordPressSeoBackend;
      namespaces: string[];
      pluginVersion: string | null;
    })
  | (BindingBase & {
      provider: "webflow";
      siteId: string;
      siteName: string;
      domains: string[];
      missingWriteScopes: string[];
    });

export type SiteResolution = {
  host: string;
  /** Visitors and crawlers get a placeholder page (e.g. WordPress.com "Coming soon"). */
  placeholder: boolean;
  binding: SiteBinding | null;
  /** Every connected source that claims this host, verified or not. */
  candidates: SiteBinding[];
  fingerprint: PageFingerprint | null;
  problems: string[];
};

const db = supabaseAdmin as unknown as { from: (table: string) => any };

const norm = (host: string) =>
  host
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/\.$/, "");

const FINGERPRINT_TTL_MS = 10 * 60_000;
const fingerprintCache = new Map<string, { at: number; value: PageFingerprint | null }>();

/** The live home page's platform stamp (cached briefly per host). */
export async function liveFingerprint(host: string): Promise<PageFingerprint | null> {
  const key = norm(host);
  const cached = fingerprintCache.get(key);
  if (cached && Date.now() - cached.at < FINGERPRINT_TTL_MS) return cached.value;
  let value: PageFingerprint | null = null;
  try {
    const res = await safeFetch(`https://${host}/`, {
      timeoutMs: 15_000,
      maxBytes: 1_500_000,
      headers: { "user-agent": "MelloxBot/1.0 (+https://mellox.ai)" },
    });
    if (res.ok) value = fingerprintPage(res.text());
  } catch {
    value = null;
  }
  fingerprintCache.set(key, { at: Date.now(), value });
  return value;
}

const NAMESPACE_TTL_MS = 60 * 60_000;

/** The REST namespaces a WordPress site advertises publicly (plugins show up here). */
export async function wordpressNamespaces(
  workspaceId: string,
  siteUrl: string,
  opts: { refresh?: boolean } = {},
): Promise<{ namespaces: string[]; pluginVersion: string | null }> {
  const { data } = await db
    .from("wordpress_sites")
    .select("id, api_namespaces, plugin_checked_at")
    .eq("workspace_id", workspaceId)
    .eq("site_url", siteUrl)
    .maybeSingle();
  const fresh =
    data?.plugin_checked_at && Date.now() - Date.parse(data.plugin_checked_at) < NAMESPACE_TTL_MS;
  if (data && fresh && !opts.refresh)
    return { namespaces: data.api_namespaces ?? [], pluginVersion: null };
  let namespaces: string[] = data?.api_namespaces ?? [];
  let pluginVersion: string | null = null;
  try {
    const res = await safeFetch(`${siteUrl.replace(/\/+$/, "")}/wp-json/`, {
      timeoutMs: 15_000,
      maxBytes: 3_000_000,
    });
    if (res.ok) {
      const body = JSON.parse(res.text()) as { namespaces?: unknown };
      if (Array.isArray(body.namespaces))
        namespaces = body.namespaces
          .filter((n): n is string => typeof n === "string")
          .slice(0, 200);
    }
    if (namespaces.includes("mellox/v1")) {
      const status = await safeFetch(`${siteUrl.replace(/\/+$/, "")}/wp-json/mellox/v1/ping`, {
        timeoutMs: 10_000,
        maxBytes: 20_000,
      });
      if (status.ok) {
        const ping = JSON.parse(status.text()) as { version?: unknown };
        pluginVersion = typeof ping.version === "string" ? ping.version.slice(0, 20) : null;
      }
    }
  } catch {
    // Unreachable REST index: keep what we knew.
  }
  if (data?.id)
    await db
      .from("wordpress_sites")
      .update({ api_namespaces: namespaces, plugin_checked_at: new Date().toISOString() })
      .eq("id", data.id);
  return { namespaces, pluginVersion };
}

export function seoBackendFor(
  namespaces: string[],
  authType: "application_password" | "wordpress_com_oauth",
): WordPressSeoBackend {
  if (namespaces.includes("mellox/v1")) return "mellox";
  if (namespaces.includes("rankmath/v1")) return "rankmath";
  if (
    authType === "wordpress_com_oauth" ||
    namespaces.includes("jetpack/v4") ||
    namespaces.includes("wpcom/v2")
  )
    return "jetpack";
  return "none";
}

async function githubCandidates(workspaceId: string, host: string): Promise<SiteBinding[]> {
  const { data } = await supabaseAdmin
    .from("workspace_sources")
    .select(
      "id, connection_id, full_name, site_host, status, ownership_status, ownership_site_host, ownership_checked_at",
    )
    .eq("workspace_id", workspaceId)
    .eq("provider", "github");
  return (data ?? [])
    .filter((s) => s.site_host && norm(s.site_host) === host)
    .map((s) => {
      const current =
        s.status === "active" &&
        ownershipIsCurrent({
          status: s.ownership_status as OwnershipStatus,
          checkedHost: s.ownership_site_host,
          checkedAt: s.ownership_checked_at,
          siteHost: host,
        });
      return {
        provider: "github" as const,
        host,
        connectionId: s.connection_id,
        sourceId: s.id,
        fullName: s.full_name,
        verified: current,
        proof: current
          ? `${s.full_name} is proven to build ${host}.`
          : s.ownership_status === "mismatch"
            ? `The evidence says ${s.full_name} doesn't build ${host}.`
            : `${s.full_name} hasn't been proven to build ${host} recently. Check it again.`,
      };
    });
}

async function wordpressCandidate(workspaceId: string, host: string): Promise<SiteBinding | null> {
  const { data: connection } = await supabaseAdmin
    .from("workspace_connections")
    .select("id, status, verification")
    .eq("workspace_id", workspaceId)
    .eq("provider", "wordpress")
    .neq("status", "revoked")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!connection) return null;
  const { data: sites } = await db
    .from("wordpress_sites")
    .select("site_url, selected, status")
    .eq("workspace_id", workspaceId)
    .eq("connection_id", connection.id);
  const site = (sites ?? []).find(
    (s: { site_url: string; selected: boolean; status: string }) =>
      s.selected && s.status === "active" && hostOf(s.site_url) === host,
  );
  if (!site) return null;
  const authType =
    connection.verification === "oauth" ? "wordpress_com_oauth" : "application_password";
  const { namespaces, pluginVersion } = await wordpressNamespaces(workspaceId, site.site_url);
  return {
    provider: "wordpress",
    host,
    connectionId: connection.id,
    siteUrl: site.site_url,
    authType,
    namespaces,
    pluginVersion,
    seo: seoBackendFor(namespaces, authType),
    verified: connection.status === "active",
    proof:
      connection.status === "active"
        ? `WordPress confirms ${site.site_url} is the connected site.`
        : "The WordPress connection needs to be checked again.",
  };
}

async function webflowCandidate(workspaceId: string, host: string): Promise<SiteBinding | null> {
  const { data: connection } = await supabaseAdmin
    .from("workspace_connections")
    .select("id, status")
    .eq("workspace_id", workspaceId)
    .eq("provider", "webflow")
    .neq("status", "revoked")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!connection) return null;
  const { data: sites } = await db
    .from("webflow_sites")
    .select("site_id, site_name, domain, domains, selected, status")
    .eq("workspace_id", workspaceId)
    .eq("connection_id", connection.id);
  const site = (sites ?? []).find(
    (s: { domains: string[] | null; domain: string | null; selected: boolean; status: string }) =>
      s.selected &&
      s.status === "active" &&
      [...(s.domains ?? []), hostOf(s.domain)].some((d) => d && norm(d) === host),
  );
  if (!site) return null;
  const { data: grant } = await db
    .from("webflow_oauth_credentials")
    .select("scopes")
    .eq("connection_id", connection.id)
    .maybeSingle();
  const { missingWebflowWriteScopes } = await import("@/server/connectors/webflow/config.server");
  return {
    provider: "webflow",
    host,
    connectionId: connection.id,
    siteId: site.site_id,
    siteName: site.site_name,
    domains: site.domains ?? [],
    missingWriteScopes: missingWebflowWriteScopes(grant?.scopes ?? []),
    verified: connection.status === "active",
    proof:
      connection.status === "active"
        ? `Webflow lists ${host} as a domain of “${site.site_name}”.`
        : "The Webflow connection needs to be renewed.",
  };
}

/** Browser-safe view of a binding (no connection internals). */
export function bindingView(b: SiteBinding, placeholder = false): SiteBindingView {
  return {
    placeholder,
    provider: b.provider,
    name:
      b.provider === "github" ? b.fullName : b.provider === "wordpress" ? b.siteUrl : b.siteName,
    verified: b.verified,
    proof: b.proof,
    seoBackend: b.provider === "wordpress" ? b.seo : null,
    pluginVersion: b.provider === "wordpress" ? b.pluginVersion : null,
    missingWriteScopes: b.provider === "webflow" ? b.missingWriteScopes : [],
  };
}

/** Apply the live page's evidence: it must agree with the connection. */
export function reconcileWithLive(
  candidate: SiteBinding,
  live: PageFingerprint | null,
): SiteBinding {
  if (!live || candidate.provider === "github") return candidate;
  if (candidate.provider === "webflow") {
    if (live.platform !== "webflow")
      return {
        ...candidate,
        verified: false,
        proof: `${candidate.host} isn't served by Webflow right now, so Mellox won't change it through Webflow.`,
      };
    if (live.webflow?.siteId && live.webflow.siteId !== candidate.siteId.toLowerCase())
      return {
        ...candidate,
        verified: false,
        proof: `${candidate.host} is served by a different Webflow site than the one connected.`,
      };
    return {
      ...candidate,
      proof: `${candidate.host} is served by the connected Webflow site (site id matches the live page).`,
    };
  }
  if (live.platform === "webflow")
    return {
      ...candidate,
      verified: false,
      proof: `${candidate.host} is served by Webflow, not the connected WordPress site.`,
    };
  if (live.platform === "wordpress" && live.wordpress?.apiRoot) {
    const apiHost = hostOf(live.wordpress.apiRoot);
    if (apiHost && apiHost !== candidate.host && apiHost !== hostOf(candidate.siteUrl))
      return {
        ...candidate,
        verified: false,
        proof: `${candidate.host} is served by a different WordPress site (${apiHost}).`,
      };
  }
  return candidate;
}

/**
 * Resolve which connected source builds `host`. `live` also fetches the home
 * page and checks the platform stamp (do this before any change).
 */
export async function resolveSite(
  workspaceId: string,
  rawHost: string,
  opts: { live?: boolean } = {},
): Promise<SiteResolution> {
  const host = norm(rawHost);
  const [github, wordpress, webflow] = await Promise.all([
    githubCandidates(workspaceId, host),
    wordpressCandidate(workspaceId, host).catch(() => null),
    webflowCandidate(workspaceId, host).catch(() => null),
  ]);
  const fingerprint = opts.live ? await liveFingerprint(host) : null;
  const candidates: SiteBinding[] = [
    ...github,
    ...(wordpress ? [reconcileWithLive(wordpress, fingerprint)] : []),
    ...(webflow ? [reconcileWithLive(webflow, fingerprint)] : []),
  ];
  // Prefer the platform the live page says serves the site; then a proven repository.
  const byLive = fingerprint?.platform
    ? candidates.find((c) => c.verified && c.provider === fingerprint.platform)
    : undefined;
  const binding =
    byLive ??
    candidates.find((c) => c.verified && c.provider === "github") ??
    candidates.find((c) => c.verified) ??
    null;
  const problems = candidates.filter((c) => !c.verified).map((c) => c.proof);
  if (fingerprint?.placeholder)
    problems.unshift(
      `${host} shows visitors a "coming soon" page, so search and AI engines can't see your content. Launch the site to make changes count.`,
    );
  return {
    host,
    placeholder: Boolean(fingerprint?.placeholder),
    binding,
    candidates,
    fingerprint,
    problems,
  };
}
