// inspect.ts — pure interpretation of a repository listing: which framework
// builds the site and where its discovery files (robots, sitemap, llms.txt)
// live. Takes paths and a parsed package.json, returns names only.
import type { SourceInspection } from "@/lib/connectors/types";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const PACKAGE_FRAMEWORKS: [dependency: string, framework: string][] = [
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["astro", "Astro"],
  ["@sveltejs/kit", "SvelteKit"],
  ["@remix-run/react", "Remix"],
  ["gatsby", "Gatsby"],
  ["@docusaurus/core", "Docusaurus"],
  ["vitepress", "VitePress"],
  ["@11ty/eleventy", "Eleventy"],
  ["@angular/core", "Angular"],
  ["vue", "Vue"],
  ["react-scripts", "Create React App"],
  ["vite", "Vite"],
];

const FILE_FRAMEWORKS: [pattern: RegExp, framework: string][] = [
  [/^(hugo\.(toml|ya?ml|json)|config\.toml)$/i, "Hugo"],
  [/^_config\.ya?ml$/i, "Jekyll"],
  [/^mkdocs\.ya?ml$/i, "MkDocs"],
  [/^wp-config(-sample)?\.php$/i, "WordPress"],
  [/^index\.html?$/i, "Static HTML"],
];

export function detectFramework(
  rootEntries: string[],
  pkg: PackageJson | null,
): { framework: string | null; evidence: string | null } {
  if (pkg) {
    const deps = { ...(pkg.devDependencies ?? {}), ...(pkg.dependencies ?? {}) };
    for (const [dep, framework] of PACKAGE_FRAMEWORKS) {
      if (deps[dep]) return { framework, evidence: `package.json depends on ${dep}` };
    }
  }
  for (const [pattern, framework] of FILE_FRAMEWORKS) {
    const hit = rootEntries.find((e) => pattern.test(e));
    if (hit) return { framework, evidence: `${hit} at the repository root` };
  }
  return { framework: null, evidence: null };
}

const IGNORED_DIRS = /(^|\/)(node_modules|\.git|vendor|dist|build|\.next|out|coverage|\.cache)\//;

/** Shallowest match wins (a root robots.txt beats one in a test fixture). */
function findPath(paths: string[], pattern: RegExp): string | null {
  return (
    paths
      .filter((p) => pattern.test(p) && !IGNORED_DIRS.test(p))
      .sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length)[0] ?? null
  );
}

export function findDiscoveryFiles(paths: string[]): SourceInspection["discoveryFiles"] {
  return {
    robots: findPath(paths, /(^|\/)(robots\.txt|robots\.(ts|js|mjs))$/i),
    sitemap: findPath(
      paths,
      /(^|\/)(sitemap[\w-]*\.xml|sitemap\.(ts|js|mjs)|sitemap\.xml\/route\.(ts|js))$/i,
    ),
    llms: findPath(paths, /(^|\/)(llms(-full)?\.txt|llms\.txt\/route\.(ts|js))$/i),
  };
}

export function buildInspection(input: {
  branch: string;
  commitSha: string | null;
  rootEntries: string[];
  paths: string[];
  truncated: boolean;
  pkg: PackageJson | null;
  now: Date;
}): SourceInspection {
  const { framework, evidence } = detectFramework(input.rootEntries, input.pkg);
  return {
    inspectedAt: input.now.toISOString(),
    branch: input.branch,
    commitSha: input.commitSha,
    framework,
    frameworkEvidence: evidence,
    discoveryFiles: findDiscoveryFiles(input.paths),
    rootEntries: input.rootEntries.slice(0, 40),
    truncated: input.truncated,
  };
}
