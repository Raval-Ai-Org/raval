// groups.ts — cluster a site's pages into groups of comparable pages by URL
// pattern, and find the repository file that renders a pattern (ADR-0024 §5).
// Pure: input is page paths (from Search Console) and repository paths.

export type PageTraffic = { path: string; clicks: number; impressions: number };

export type GroupCandidate = {
  /** e.g. "/products/*" or "/blog/*\/reviews" */
  pattern: string;
  label: string;
  paths: string[];
  clicks: number;
  impressions: number;
};

/** Minimum pages for a pattern to be offered at all (eligibility is stricter). */
export const MIN_GROUP_PAGES = 8;
export const MAX_GROUPS = 12;

/** Path only: leading slash, no query/fragment, no trailing slash (except "/"), lower-case host ignored. */
export function normalizePath(input: string): string | null {
  let path = input.trim();
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  path = path.split(/[?#]/)[0];
  if (!path.startsWith("/")) path = `/${path}`;
  try {
    path = decodeURI(path);
  } catch {
    // keep as sent
  }
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path.length <= 600 ? path : null;
}

export function segmentsOf(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function matchesPattern(path: string, pattern: string): boolean {
  const a = segmentsOf(path);
  const b = segmentsOf(pattern);
  return a.length === b.length && b.every((seg, i) => seg === "*" || seg === a[i]);
}

function labelFor(pattern: string): string {
  const literal = segmentsOf(pattern).filter((s) => s !== "*");
  if (!literal.length) return "Top-level pages";
  const words = literal.map((s) => s.replace(/[-_]+/g, " "));
  const text = words.join(" › ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} pages`.slice(0, 120);
}

/**
 * Candidate patterns replace one varying segment with "*". Each path goes to
 * the largest pattern it fits; patterns smaller than MIN_GROUP_PAGES are
 * dropped. The site root and file-like paths never join a group.
 */
export function clusterPages(pages: PageTraffic[], minPages = MIN_GROUP_PAGES): GroupCandidate[] {
  const byPath = new Map<string, PageTraffic>();
  for (const p of pages) {
    const path = normalizePath(p.path);
    if (!path || path === "/" || /\.[a-z0-9]{2,5}$/i.test(path)) continue;
    const prev = byPath.get(path);
    byPath.set(path, {
      path,
      clicks: (prev?.clicks ?? 0) + p.clicks,
      impressions: (prev?.impressions ?? 0) + p.impressions,
    });
  }

  const candidates = new Map<string, Set<string>>();
  for (const path of byPath.keys()) {
    const segs = segmentsOf(path);
    for (let i = 0; i < segs.length; i++) {
      // A wildcard in the first position only makes sense for one-segment paths.
      if (i === 0 && segs.length > 1) continue;
      const pattern = `/${segs.map((s, j) => (j === i ? "*" : s)).join("/")}`;
      if (!candidates.has(pattern)) candidates.set(pattern, new Set());
      candidates.get(pattern)!.add(path);
    }
  }

  const ordered = [...candidates.entries()]
    .filter(([, set]) => set.size >= minPages)
    .sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1));

  const taken = new Set<string>();
  const groups: GroupCandidate[] = [];
  for (const [pattern, set] of ordered) {
    const paths = [...set].filter((p) => !taken.has(p)).sort();
    if (paths.length < minPages) continue;
    paths.forEach((p) => taken.add(p));
    let clicks = 0;
    let impressions = 0;
    for (const p of paths) {
      clicks += byPath.get(p)!.clicks;
      impressions += byPath.get(p)!.impressions;
    }
    groups.push({ pattern, label: labelFor(pattern), paths, clicks, impressions });
    if (groups.length >= MAX_GROUPS) break;
  }
  return groups.sort((a, b) => b.clicks - a.clicks || (a.pattern < b.pattern ? -1 : 1));
}

/* ───────────────────────── template files ───────────────────────── */

export type TemplateFramework =
  "next-app" | "next-pages" | "astro" | "nuxt" | "sveltekit" | "remix" | null;

export function templateFrameworkFor(framework: string | null, paths: string[]): TemplateFramework {
  const has = (re: RegExp) => paths.some((p) => re.test(p));
  switch (framework) {
    case "Next.js":
      if (has(/(^|\/)(src\/)?app\/(.+\/)?page\.(tsx|jsx|ts|js)$/)) return "next-app";
      if (has(/(^|\/)(src\/)?pages\/.+\.(tsx|jsx|ts|js)$/)) return "next-pages";
      return null;
    case "Astro":
      return "astro";
    case "Nuxt":
      return "nuxt";
    case "SvelteKit":
      return "sveltekit";
    case "Remix":
      return "remix";
    default:
      return null;
  }
}

const DYNAMIC = /^\[{1,2}\.{0,3}[^\]]+\]{1,2}$/;

/** Does a route directory segment match a URL pattern segment? */
function segMatches(routeSeg: string, patternSeg: string): boolean {
  if (DYNAMIC.test(routeSeg) || routeSeg.startsWith("$")) return patternSeg === "*";
  return routeSeg === patternSeg;
}

function stripGroups(segs: string[]): string[] {
  return segs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"));
}

function routeSegments(file: string, fw: Exclude<TemplateFramework, null>): string[] | null {
  const noExt = file.replace(/\.[a-z]+$/, "");
  let m: RegExpMatchArray | null;
  switch (fw) {
    case "next-app":
      m = file.match(/^(?:.*\/)?(?:src\/)?app\/(.*?)\/?page\.(tsx|jsx|ts|js)$/);
      return m ? stripGroups(m[1].split("/").filter(Boolean)) : null;
    case "next-pages":
      m = noExt.match(/^(?:.*\/)?(?:src\/)?pages\/(.+)$/);
      if (!m || /^(_app|_document|_error|api\/)/.test(m[1])) return null;
      return m[1].split("/").filter((s, i, all) => !(s === "index" && i === all.length - 1));
    case "astro":
      m = noExt.match(/^(?:.*\/)?src\/pages\/(.+)$/);
      if (!m || !file.endsWith(".astro")) return null;
      return m[1].split("/").filter((s, i, all) => !(s === "index" && i === all.length - 1));
    case "nuxt":
      m = noExt.match(/^(?:.*\/)?pages\/(.+)$/);
      if (!m || !file.endsWith(".vue")) return null;
      return m[1].split("/").filter((s, i, all) => !(s === "index" && i === all.length - 1));
    case "sveltekit":
      m = file.match(/^(?:.*\/)?src\/routes\/(.*?)\/?\+page\.svelte$/);
      return m ? stripGroups(m[1].split("/").filter(Boolean)) : null;
    case "remix":
      m = noExt.match(/^(?:.*\/)?app\/routes\/(.+)$/);
      if (!m) return null;
      return m[1]
        .replace(/\/route$/, "")
        .split(".")
        .filter((s) => s && s !== "_index" && !s.startsWith("_"));
  }
}

/** The route file that renders every page of `pattern`, or null. */
export function findTemplateFile(
  pattern: string,
  repoPaths: string[],
  fw: TemplateFramework,
): string | null {
  if (!fw) return null;
  const want = segmentsOf(pattern);
  const hits: string[] = [];
  for (const file of repoPaths) {
    if (/(^|\/)(node_modules|\.next|dist|build|out)\//.test(file)) continue;
    const segs = routeSegments(file, fw);
    if (!segs || segs.length !== want.length) continue;
    if (segs.every((s, i) => segMatches(s, want[i]))) hits.push(file);
  }
  // Prefer the shallowest (a monorepo's app over a fixture).
  hits.sort((a, b) => a.split("/").length - b.split("/").length || (a < b ? -1 : 1));
  return hits[0] ?? null;
}
