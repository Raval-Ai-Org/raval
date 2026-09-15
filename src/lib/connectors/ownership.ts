// ownership.ts — does this repository actually build this website?
//
// Mellox only proposes changes to a repository once it has evidence that the
// repository is the source of the scanned site. Evidence is collected on the
// server (src/server/connectors/github/ownership.server.ts); this module is the
// pure part: host normalisation, content fingerprints, config parsing and the
// verdict. Browser-safe (plain data, no secrets).
//
//   positive signals combine as 1 − Π(1 − wᵢ); negatives subtract.
//   verified  confidence ≥ 0.80 and (a strong signal or content ≥ 0.30)
//   likely    confidence ≥ 0.50
//   mismatch  a negative signal and weak positives
//   otherwise unverified

export type OwnershipStatus =
  "unchecked" | "checking" | "verified" | "likely" | "unverified" | "mismatch" | "attested";

export type OwnershipSignal =
  | "deployment_url"
  | "pages_site"
  | "pages_cname"
  | "repo_homepage"
  | "config_site_url"
  | "host_literal"
  | "content_fingerprint"
  | "homepage_other_host"
  | "deployments_unavailable"
  | "content_absent";

export type OwnershipEvidence = {
  signal: OwnershipSignal;
  /** Contribution in [0, 1]; negatives are subtracted. */
  weight: number;
  polarity: "positive" | "negative" | "neutral";
  detail: string;
  path?: string;
  url?: string;
};

export type OwnershipResult = {
  status: Exclude<OwnershipStatus, "unchecked" | "checking" | "attested">;
  confidence: number;
  evidence: OwnershipEvidence[];
  /** What the user can do to prove ownership when it isn't verified. */
  hints: string[];
};

export const SIGNAL_WEIGHTS: Record<OwnershipSignal, number> = {
  deployment_url: 0.6,
  pages_site: 0.6,
  pages_cname: 0.5,
  repo_homepage: 0.45,
  config_site_url: 0.3,
  host_literal: 0.2,
  content_fingerprint: 0.45,
  homepage_other_host: 0.4,
  deployments_unavailable: 0,
  content_absent: 0,
};

/**
 * GitHub itself reports that it serves / deployed this repository at the host
 * (Pages API, a successful deployment status). Each proves ownership alone.
 */
const DEFINITIVE: ReadonlySet<OwnershipSignal> = new Set(["deployment_url", "pages_site"]);

/** Owner-declared or hosting-config evidence: proof when independent content evidence agrees. */
const STRONG: ReadonlySet<OwnershipSignal> = new Set([
  "deployment_url",
  "pages_site",
  "pages_cname",
  "repo_homepage",
]);

/** Preview / platform hosts that say nothing about the production domain. */
const PLATFORM_HOST =
  /\.(vercel\.app|netlify\.app|pages\.dev|github\.io|herokuapp\.com|onrender\.com|fly\.dev|web\.app|firebaseapp\.com|surge\.sh|railway\.app|amplifyapp\.com)$/i;

/** Lowercase hostname without `www.`, trailing dot, port or scheme. Null if not a host. */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  try {
    const host = new URL(value).hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^www\./, "");
    if (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

export function hostsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeHost(a);
  const y = normalizeHost(b);
  return Boolean(x && y && x === y);
}

export function isPlatformHost(host: string): boolean {
  return PLATFORM_HOST.test(host);
}

/* ───────────────────────── config files ───────────────────────── */

/** Config files whose site URL settings name the production host. */
export const CONFIG_FILE_PATTERN =
  /(^|\/)(package\.json|astro\.config\.[cm]?[jt]s|nuxt\.config\.[cm]?[jt]s|next-sitemap\.config\.[cm]?js|docusaurus\.config\.[cm]?[jt]s|hugo\.(toml|ya?ml|json)|config\.toml|_config\.ya?ml|vercel\.json|netlify\.toml|CNAME|site\.webmanifest|manifest\.json|robots\.txt|sitemap[\w-]*\.xml)$/i;

const URL_IN_TEXT = /https?:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?/gi;

/** Hosts a config file declares for the site (CNAME is a bare host). */
export function hostsInConfig(path: string, text: string): string[] {
  const name = path.split("/").pop() ?? path;
  const hosts = new Set<string>();
  if (/^CNAME$/i.test(name)) {
    const host = normalizeHost(text.split(/\r?\n/)[0]);
    if (host) hosts.add(host);
    return [...hosts];
  }
  if (/^package\.json$/i.test(name)) {
    try {
      const pkg = JSON.parse(text) as { homepage?: unknown };
      const host = typeof pkg.homepage === "string" ? normalizeHost(pkg.homepage) : null;
      if (host) hosts.add(host);
    } catch {
      /* not JSON */
    }
    return [...hosts];
  }
  for (const m of text.matchAll(URL_IN_TEXT)) {
    const host = normalizeHost(m[0]);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

/* ───────────────────────── content fingerprints ───────────────────────── */

export type PageFingerprintInput = {
  url: string;
  title: string | null;
  description: string | null;
  h1: string[];
  /** Readable page text (excerpt or full main text). */
  text: string;
  orgName?: string | null;
};

export type ContentFingerprints = {
  /** Title / description / H1 / organisation name (short, identifying). */
  identity: string[];
  /** Distinctive sentences, deduplicated across pages (boilerplate removed). */
  sentences: string[];
};

export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/&(amp|nbsp|quot|#39|apos|lt|gt);/g, (m) =>
      m === "&amp;"
        ? "&"
        : m === "&lt;"
          ? "<"
          : m === "&gt;"
            ? ">"
            : m === "&quot;"
              ? '"'
              : m === "&nbsp;"
                ? " "
                : "'",
    )
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const BOILERPLATE =
  /\b(cookie|cookies|privacy policy|terms of (use|service)|all rights reserved|copyright|©|sign in|log in|sign up|subscribe|newsletter|skip to (main )?content|menu|javascript)\b/i;

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 160 && !BOILERPLATE.test(s));
}

export function contentFingerprints(pages: PageFingerprintInput[]): ContentFingerprints {
  const identity = new Set<string>();
  const counts = new Map<string, number>();
  const firstSeen: string[] = [];
  for (const p of pages.slice(0, 5)) {
    for (const v of [p.title, p.description, p.orgName, ...p.h1]) {
      const n = v ? normalizeText(v) : "";
      if (n.length >= 12 && n.length <= 200) identity.add(n);
    }
    for (const s of new Set(sentencesOf(p.text).map(normalizeText))) {
      if (!counts.has(s)) firstSeen.push(s);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  // A sentence on every page is navigation or footer text, not page content.
  const multiPage = pages.length > 1;
  const sentences = firstSeen
    .filter((s) => !multiPage || (counts.get(s) ?? 0) < Math.min(pages.length, 5))
    .slice(0, 25);
  return { identity: [...identity].slice(0, 20), sentences };
}

/** Text files worth searching for fingerprints. */
export const CONTENT_FILE_PATTERN =
  /\.(html?|tsx|jsx|vue|svelte|astro|mdx?|json|ya?ml|txt|njk|hbs|liquid|php)$/i;

/** Strip markup and JSX/template noise so rendered text can be found in source. */
export function sourceText(text: string): string {
  return normalizeText(
    text
      .replace(/<script(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      // Keep human-readable attribute values (meta content, alt, title, aria-label).
      .replace(
        /\s(?:content|alt|title|aria-label|placeholder)\s*=\s*(["'])([\s\S]*?)\1/gi,
        (_m, _q, value: string) => `> ${value} <`,
      )
      .replace(/<[^>]+>/g, " ")
      .replace(/\{\s*["'`]([^"'`]*)["'`]\s*\}/g, "$1")
      .replace(/\\n/g, " "),
  );
}

export type FingerprintMatch = {
  identityMatched: string[];
  sentencesMatched: number;
  sentencesTotal: number;
  paths: string[];
  score: number;
};

export function matchFingerprints(
  fingerprints: ContentFingerprints,
  files: { path: string; text: string }[],
): FingerprintMatch {
  const haystacks = files.map((f) => ({ path: f.path, text: sourceText(f.text) }));
  const paths = new Set<string>();
  const find = (needle: string) => {
    const hit = haystacks.find((h) => h.text.includes(needle));
    if (hit) paths.add(hit.path);
    return Boolean(hit);
  };
  const identityMatched = fingerprints.identity.filter(find);
  const sentencesMatched = fingerprints.sentences.filter(find).length;
  const total = fingerprints.sentences.length;
  // Each distinct identifying value (title, description, H1, organisation) found
  // in source counts; two of them together are as strong as page copy.
  const score = Math.min(
    SIGNAL_WEIGHTS.content_fingerprint,
    Math.min(0.3, 0.15 * identityMatched.length) + (total ? 0.3 * (sentencesMatched / total) : 0),
  );
  return {
    identityMatched,
    sentencesMatched,
    sentencesTotal: total,
    paths: [...paths].slice(0, 10),
    score: Math.round(score * 1000) / 1000,
  };
}

/* ───────────────────────── verdict ───────────────────────── */

export function scoreOwnership(evidence: OwnershipEvidence[]): OwnershipResult {
  const positives = evidence.filter((e) => e.polarity === "positive" && e.weight > 0);
  const negatives = evidence.filter((e) => e.polarity === "negative" && e.weight > 0);
  // One contribution per signal: the strongest item of each kind.
  const best = new Map<OwnershipSignal, number>();
  for (const e of positives)
    best.set(e.signal, Math.max(best.get(e.signal) ?? 0, Math.min(1, e.weight)));
  const pos = 1 - [...best.values()].reduce((p, w) => p * (1 - w), 1);
  const neg = negatives.reduce((s, e) => s + Math.min(1, e.weight), 0);
  const confidence = Math.round(Math.max(0, Math.min(1, pos - neg)) * 1000) / 1000;
  const definitive = [...best.keys()].some((s) => DEFINITIVE.has(s));
  const strong = [...best.keys()].some((s) => STRONG.has(s));
  const content = best.get("content_fingerprint") ?? 0;

  let status: OwnershipResult["status"];
  if (!negatives.length && (definitive || (strong && content >= 0.3))) status = "verified";
  else if (confidence >= 0.8 && (strong || content >= 0.3)) status = "verified";
  else if (negatives.length && pos < 0.5) status = "mismatch";
  else if (confidence >= 0.5) status = "likely";
  else status = "unverified";

  const hints: string[] = [];
  if (status !== "verified") {
    if (!best.has("repo_homepage"))
      hints.push("Set the repository's Website field on GitHub to the site's URL.");
    if (evidence.some((e) => e.signal === "deployments_unavailable"))
      hints.push(
        "Grant the Mellox GitHub App “Deployments: read” so production deployments can be matched.",
      );
    else if (!best.has("deployment_url"))
      hints.push(
        "Deploy the site from this repository with a platform that reports GitHub deployments (Vercel, Netlify, Cloudflare Pages).",
      );
    if (!content)
      hints.push(
        "Check that this branch contains the site's pages — none of the live page text was found in it.",
      );
    if (negatives.length)
      hints.push(
        "This repository points at a different website; pick the repository that builds this site.",
      );
  }
  return { status, confidence, evidence, hints };
}

/** Whether a fix may be proposed against a source with this ownership state. */
export function ownershipAllowsFixes(status: OwnershipStatus | null | undefined): boolean {
  return status === "verified" || status === "attested";
}

/** Re-check after a week, or when the host being fixed isn't the host that was checked. */
export const OWNERSHIP_TTL_MS = 7 * 24 * 60 * 60_000;

export function ownershipIsCurrent(input: {
  status: OwnershipStatus | null | undefined;
  checkedHost: string | null | undefined;
  checkedAt: string | null | undefined;
  siteHost: string | null | undefined;
  now?: number;
}): boolean {
  if (!ownershipAllowsFixes(input.status)) return false;
  if (!hostsMatch(input.checkedHost, input.siteHost)) return false;
  if (!input.checkedAt) return false;
  return (input.now ?? Date.now()) - Date.parse(input.checkedAt) < OWNERSHIP_TTL_MS;
}
