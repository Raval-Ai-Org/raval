// ownership.server.ts — collect evidence that a repository builds a website,
// score it (src/lib/connectors/ownership.ts) and persist the verdict on the
// source row. Read-only against GitHub; bounded in API calls and bytes.
//
// Evidence, strongest first:
//   deployments   a GitHub deployment whose environment URL is the site host
//   CNAME         GitHub Pages custom domain, or <host>.github.io
//   homepage      the repository's Website field (a different host counts against)
//   config        site URLs in package.json / astro / docusaurus / vercel / robots …
//   content       live page title, H1s and distinctive sentences found in source
//   host literal  the host written in source files
//
// Nothing here trusts the user's choice of site: a repository is only
// "verified" when the evidence says so.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import {
  CONFIG_FILE_PATTERN,
  CONTENT_FILE_PATTERN,
  contentFingerprints,
  hostsInConfig,
  isPlatformHost,
  matchFingerprints,
  normalizeHost,
  scoreOwnership,
  SIGNAL_WEIGHTS,
  type OwnershipEvidence,
  type OwnershipResult,
  type PageFingerprintInput,
} from "@/lib/connectors/ownership";
import type { SourceView } from "@/lib/connectors/types";
import type { PageAnalysis } from "@/lib/geo/types";
import { recordAudit } from "@/server/audit.server";
import {
  getBranch,
  getDeploymentStatuses,
  getRepository,
  getTreeEntries,
  getPagesSite,
  getTreeScoped,
  listDeployments,
  readBlob,
  type TreeEntry,
} from "./git.server";
import { checkReadPath } from "./paths";
import { presentSource, SOURCE_COLS, type ConnectionRow, type SourceRow } from "../present";
import { withAccess } from "./service.server";

const MAX_CONFIG_FILES = 15;
const MAX_CONTENT_BLOBS = 150;
const MAX_CONTENT_BYTES = 6_000_000;
const MAX_FILE_BYTES = 200_000;
const MAX_DEPLOYMENT_STATUS_CALLS = 8;

const IGNORED =
  /(^|\/)(node_modules|\.git|dist|build|out|\.next|\.nuxt|\.output|coverage|vendor|__tests__|__mocks__|test|tests|fixtures|e2e|cypress|storybook-static)\//i;
const TEST_FILE = /\.(test|spec|stories)\.[a-z]+$/i;

export type OwnershipDeps = {
  getRepository: typeof getRepository;
  listDeployments: typeof listDeployments;
  getDeploymentStatuses: typeof getDeploymentStatuses;
  getBranch: typeof getBranch;
  getTreeEntries: typeof getTreeEntries;
  getTreeScoped: typeof getTreeScoped;
  readBlob: typeof readBlob;
  getPagesSite: typeof getPagesSite;
};

const defaultDeps: OwnershipDeps = {
  getPagesSite,
  getRepository,
  listDeployments,
  getDeploymentStatuses,
  getBranch,
  getTreeEntries,
  getTreeScoped,
  readBlob,
};

/** Order content candidates so page sources are read before everything else. */
function contentPriority(path: string): number {
  // Root files (index.html, README, manifests) say the most about what a repository builds.
  if (!path.includes("/") || /(^|\/)(index\.html?)$/i.test(path)) return 0;
  if (/^(src\/)?(app|pages|routes)\//.test(path)) return 1;
  if (/^(src\/)?(content|posts|blog|data|locales|i18n|messages)\//.test(path)) return 2;
  if (/^(src\/)?(components|layouts|sections|views)\//.test(path)) return 3;
  if (/^public\//.test(path)) return 4;
  return 5;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * Collect and score evidence. Pure with respect to storage: callers persist.
 * `pages` are the live pages Mellox scanned for `siteHost` (home first).
 */
export async function collectOwnershipEvidence(
  args: {
    installationId: string;
    repo: string;
    branch: string;
    siteHost: string;
    pages: PageFingerprintInput[];
  },
  deps: OwnershipDeps = defaultDeps,
): Promise<OwnershipResult & { commitSha: string | null; truncatedTree: boolean }> {
  const host = normalizeHost(args.siteHost);
  if (!host) throw new Error("A website host is required to verify ownership.");
  const evidence: OwnershipEvidence[] = [];
  const add = (e: OwnershipEvidence) => evidence.push(e);

  /* ── Repository homepage ── */
  const repo = await deps.getRepository(args.installationId, args.repo);
  if (repo?.homepage) {
    const h = normalizeHost(repo.homepage);
    if (h === host) {
      add({
        signal: "repo_homepage",
        weight: SIGNAL_WEIGHTS.repo_homepage,
        polarity: "positive",
        detail: `The repository's Website field is ${repo.homepage}.`,
        url: repo.homepage,
      });
    } else if (h && !isPlatformHost(h)) {
      add({
        signal: "homepage_other_host",
        weight: SIGNAL_WEIGHTS.homepage_other_host,
        polarity: "negative",
        detail: `The repository's Website field points at ${h}, not ${host}.`,
        url: repo.homepage,
      });
    }
  }
  /* ── GitHub Pages (GitHub itself says where the repository is served) ── */
  const pages = await deps.getPagesSite(args.installationId, args.repo);
  const pagesHost = pages ? (normalizeHost(pages.cname) ?? normalizeHost(pages.url)) : null;
  if (pagesHost === host) {
    add({
      signal: "pages_site",
      weight: SIGNAL_WEIGHTS.pages_site,
      polarity: "positive",
      detail: `GitHub Pages serves this repository at ${pages!.url}${pages!.sourceBranch ? ` (from ${pages!.sourceBranch})` : ""}.`,
      url: pages!.url,
    });
  } else if (
    repo &&
    repo.fullName.toLowerCase().endsWith(`/${host}`) &&
    host.endsWith(".github.io")
  ) {
    add({
      signal: "pages_cname",
      weight: SIGNAL_WEIGHTS.pages_cname,
      polarity: "positive",
      detail: `${repo.fullName} is the GitHub Pages repository for ${host}.`,
    });
  } else if (pagesHost && !isPlatformHost(pagesHost)) {
    add({
      signal: "homepage_other_host",
      weight: SIGNAL_WEIGHTS.homepage_other_host,
      polarity: "negative",
      detail: `GitHub Pages serves this repository at ${pagesHost}, not ${host}.`,
      url: pages!.url,
    });
  }

  /* ── Deployments ── */
  const deployments = await deps.listDeployments(args.installationId, args.repo, { perPage: 30 });
  if (!deployments.available) {
    add({
      signal: "deployments_unavailable",
      weight: 0,
      polarity: "neutral",
      detail: "Deployments couldn't be read (the GitHub App needs “Deployments: read”).",
    });
  } else {
    const ordered = [...deployments.deployments].sort(
      (a, b) =>
        Number(b.productionEnvironment) - Number(a.productionEnvironment) ||
        b.createdAt.localeCompare(a.createdAt),
    );
    let calls = 0;
    for (const d of ordered) {
      if (calls >= MAX_DEPLOYMENT_STATUS_CALLS) break;
      calls++;
      const statuses = await deps.getDeploymentStatuses(args.installationId, args.repo, d.id);
      const hit = statuses.find(
        (s) => s.state === "success" && normalizeHost(s.environmentUrl) === host,
      );
      if (hit) {
        add({
          signal: "deployment_url",
          weight: SIGNAL_WEIGHTS.deployment_url,
          polarity: "positive",
          detail: `A successful “${d.environment}” deployment of ${d.sha.slice(0, 7)} is served at ${host}.`,
          url: hit.environmentUrl ?? undefined,
        });
        break;
      }
    }
  }

  /* ── Tree ── */
  const branch = await deps.getBranch(args.installationId, args.repo, args.branch);
  if (!branch) throw new Error(`Branch “${args.branch}” doesn't exist in ${args.repo}.`);
  const tree = await deps.getTreeEntries(args.installationId, args.repo, branch.treeSha);
  const truncated = tree.truncated;
  let entries = tree.entries;
  if (truncated) {
    entries = await deps.getTreeScoped(args.installationId, args.repo, branch.treeSha, [
      "src",
      "app",
      "pages",
      "public",
      "content",
      "components",
      "layouts",
      "docs",
      "static",
    ]);
  }
  const readable = entries.filter(
    (e) => checkReadPath(e.path).ok && !IGNORED.test(e.path) && e.size <= MAX_FILE_BYTES,
  );
  const blobCache = new Map<string, string | null>();
  const read = async (e: TreeEntry) => {
    if (!blobCache.has(e.sha))
      blobCache.set(e.sha, await deps.readBlob(args.installationId, args.repo, e.sha));
    return blobCache.get(e.sha) ?? null;
  };

  /* ── CNAME + config site URLs ── */
  const configs = readable
    .filter((e) => CONFIG_FILE_PATTERN.test(e.path) && e.path.split("/").length <= 3)
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)
    .slice(0, MAX_CONFIG_FILES);
  for (const e of configs) {
    const text = await read(e);
    if (!text) continue;
    const hosts = hostsInConfig(e.path, text);
    if (!hosts.includes(host)) continue;
    const isCname = /(^|\/)CNAME$/i.test(e.path);
    add({
      signal: isCname ? "pages_cname" : "config_site_url",
      weight: isCname ? SIGNAL_WEIGHTS.pages_cname : SIGNAL_WEIGHTS.config_site_url,
      polarity: "positive",
      detail: isCname
        ? `${e.path} sets the custom domain ${host}.`
        : `${e.path} declares ${host} as a site URL.`,
      path: e.path,
    });
  }

  /* ── Content fingerprints + host literal ── */
  const candidates = readable
    .filter(
      (e) =>
        CONTENT_FILE_PATTERN.test(e.path) &&
        !TEST_FILE.test(e.path) &&
        !/lock|\.min\./i.test(e.path),
    )
    .sort((a, b) => contentPriority(a.path) - contentPriority(b.path) || a.size - b.size);
  const picked: TreeEntry[] = [];
  let bytes = 0;
  for (const e of candidates) {
    if (picked.length >= MAX_CONTENT_BLOBS || bytes + e.size > MAX_CONTENT_BYTES) break;
    picked.push(e);
    bytes += e.size;
  }
  const texts = (
    await mapLimit(picked, 8, async (e) => ({ path: e.path, text: (await read(e)) ?? "" }))
  ).filter((f) => f.text);

  const fingerprints = contentFingerprints(args.pages);
  if (fingerprints.identity.length || fingerprints.sentences.length) {
    const match = matchFingerprints(fingerprints, texts);
    if (match.score > 0) {
      add({
        signal: "content_fingerprint",
        weight: match.score,
        polarity: "positive",
        detail: `Live page text found in the source: ${match.identityMatched.length} title/heading value(s) and ${match.sentencesMatched} of ${match.sentencesTotal} distinctive sentences.`,
        path: match.paths[0],
      });
    } else {
      add({
        signal: "content_absent",
        weight: 0,
        polarity: "neutral",
        detail: `None of the live page text was found in ${texts.length} source file(s) (content may come from a CMS).`,
      });
    }
  }
  const literal = texts.filter((f) => f.text.toLowerCase().includes(host)).map((f) => f.path);
  if (literal.length) {
    add({
      signal: "host_literal",
      weight: literal.length >= 2 ? SIGNAL_WEIGHTS.host_literal : SIGNAL_WEIGHTS.host_literal / 2,
      polarity: "positive",
      detail: `${host} is written in ${literal.length} source file(s).`,
      path: literal[0],
    });
  }

  return { ...scoreOwnership(evidence), commitSha: branch.sha, truncatedTree: truncated };
}

/* ───────────────────────── page facts from scans ───────────────────────── */

type PageRow = {
  url: string;
  state: string;
  status_code: number | null;
  analysis: PageAnalysis | null;
};

export function pageFingerprintInput(a: PageAnalysis): PageFingerprintInput {
  return {
    url: a.url,
    title: a.title,
    description: a.metaDescription,
    h1: a.headings
      .filter((h) => h.level === 1)
      .map((h) => h.text)
      .slice(0, 3),
    text: [a.text.excerpt, ...a.headings.slice(0, 20).map((h) => h.text)].join("\n"),
    orgName: a.schema.organizations[0]?.name ?? a.trust.siteName ?? null,
  };
}

/** Up to five analysed pages (home first) from the latest successful scan of `host`. */
export async function loadSitePages(
  workspaceId: string,
  host: string,
): Promise<PageFingerprintInput[]> {
  const bare = host.replace(/^www\./, "");
  const { data: scans } = await supabaseAdmin
    .from("geo_scans")
    .select("id, host")
    .eq("workspace_id", workspaceId)
    .in("host", [bare, `www.${bare}`])
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1);
  const scan = scans?.[0];
  if (!scan) return [];
  const { data } = await supabaseAdmin
    .from("geo_scan_pages")
    .select("url, state, status_code, analysis")
    .eq("scan_id", scan.id)
    .eq("state", "fetched")
    .limit(60);
  const rows = ((data ?? []) as unknown as PageRow[]).filter(
    (r) => r.analysis && (r.status_code ?? 200) < 400,
  );
  rows.sort(
    (a, b) =>
      Number(b.analysis!.pageType === "home") - Number(a.analysis!.pageType === "home") ||
      b.analysis!.text.words - a.analysis!.text.words,
  );
  return rows.slice(0, 5).map((r) => pageFingerprintInput(r.analysis!));
}

/** Live homepage through the SSRF-guarded fetcher, when no scan exists yet. */
async function fetchHomePage(host: string): Promise<PageFingerprintInput[]> {
  const [{ fetchPublicText }, { analyzePage }] = await Promise.all([
    import("@/server/safe-fetch"),
    import("@/lib/geo/analyze-page"),
  ]);
  const url = `https://${host}/`;
  const html = await fetchPublicText(url, {
    timeoutMs: 15_000,
    maxBytes: 2_000_000,
    onOverflow: "truncate",
  }).catch(() => "");
  return html ? [pageFingerprintInput(analyzePage(html, url))] : [];
}

/* ───────────────────────── service entry point ───────────────────────── */

export async function verifySourceOwnership(args: {
  source: SourceRow;
  connection: ConnectionRow;
  userId: string | null;
  /** Defaults to the source's linked site. */
  siteHost?: string | null;
}): Promise<SourceView> {
  const { source, connection } = args;
  const host = normalizeHost(args.siteHost ?? source.site_host);
  if (!host) throw new Error("Link a website to this repository before verifying it.");
  const branch = source.branch ?? source.default_branch ?? "main";

  await supabaseAdmin
    .from("workspace_sources")
    .update({ ownership_status: "checking" })
    .eq("id", source.id);
  try {
    let pages = await loadSitePages(source.workspace_id, host);
    if (!pages.length) pages = await fetchHomePage(host);
    const result = await withAccess(connection, args.userId, () =>
      collectOwnershipEvidence({
        installationId: connection.external_account_id,
        repo: source.full_name,
        branch,
        siteHost: host,
        pages,
      }),
    );
    const { data: row, error } = await supabaseAdmin
      .from("workspace_sources")
      .update({
        ownership_status: result.status,
        ownership_confidence: result.confidence,
        ownership_site_host: host,
        ownership_commit_sha: result.commitSha,
        ownership_evidence: result.evidence as unknown as Json,
        ownership_hints: result.hints as unknown as Json,
        ownership_checked_at: new Date().toISOString(),
        ownership_checked_by: args.userId,
      })
      .eq("id", source.id)
      .select(SOURCE_COLS)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Couldn't save the ownership check");
    await recordAudit({
      workspaceId: source.workspace_id,
      userId: args.userId,
      action: "connector.github.ownership_checked",
      entity: "workspace_source",
      payload: {
        sourceId: source.id,
        repository: source.full_name,
        branch,
        siteHost: host,
        status: result.status,
        confidence: result.confidence,
        signals: result.evidence.map((e) => e.signal),
        pagesCompared: pages.length,
      },
    });
    return presentSource(row as unknown as SourceRow);
  } catch (error) {
    // Never leave a source stuck in "checking"; an unfinished check proves nothing.
    await supabaseAdmin
      .from("workspace_sources")
      .update({
        ownership_status: "unverified",
        ownership_site_host: host,
        ownership_checked_at: new Date().toISOString(),
        last_error: (error instanceof Error ? error.message : "Ownership check failed").slice(
          0,
          500,
        ),
      })
      .eq("id", source.id);
    throw error;
  }
}
