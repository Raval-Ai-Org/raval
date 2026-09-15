// paths.ts — which repository paths Mellox may read or write, and which
// branch names it may create. Pure; enforced again right before every GitHub
// write in git.server.ts, so no caller can bypass it.
//
// Mellox only ever proposes changes to site source files (markup, page
// components, discovery files). It never touches CI, dependency manifests,
// lockfiles, environment files, git internals or anything executable at build
// time beyond the page source itself.

export const MAX_READ_BYTES = 512_000;
export const MAX_WRITE_BYTES = 200_000;
export const MAX_FILES_PER_CHANGE = 4;

const ALLOWED_EXTENSIONS = new Set([
  "html",
  "htm",
  "tsx",
  "ts",
  "jsx",
  "js",
  "mjs",
  "vue",
  "svelte",
  "astro",
  "txt",
  "xml",
  "json",
  "md",
  "mdx",
]);

const DENIED_SEGMENTS =
  /(^|\/)(\.git|\.github|\.gitlab|\.circleci|\.husky|node_modules|vendor)(\/|$)/i;
const DENIED_FILES =
  /(^|\/)(\.env[^/]*|package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|npm-shrinkwrap\.json|\.npmrc|\.yarnrc(\.yml)?|dockerfile|docker-compose[^/]*|vercel\.json|netlify\.toml|firebase\.json|next\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|nuxt\.config\.[cm]?[jt]s|astro\.config\.[cm]?[jt]s|angular\.json|tsconfig[^/]*\.json|jsconfig\.json|\.eslintrc[^/]*|eslint\.config\.[cm]?[jt]s|babel\.config\.[cm]?[jt]s|webpack\.config\.[cm]?[jt]s|middleware\.[cm]?[jt]s|makefile)$/i;

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };

/** Normalise and validate a repository-relative path Mellox wants to write. */
export function checkRepoPath(raw: string): PathCheck {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "Empty path" };
  const path = raw.trim();
  if (path.length > 300) return { ok: false, reason: "Path is too long" };
  if ([...path].some((ch) => ch.charCodeAt(0) < 32) || path.includes("\\"))
    return { ok: false, reason: "Path contains invalid characters" };
  if (path.startsWith("/") || /^[a-z]:/i.test(path))
    return { ok: false, reason: "Absolute paths aren't allowed" };
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    return { ok: false, reason: "Path traversal isn't allowed" };
  }
  if (DENIED_SEGMENTS.test(path)) return { ok: false, reason: "That directory is off-limits" };
  if (DENIED_FILES.test(path)) {
    return { ok: false, reason: "Mellox never changes configuration, dependency or CI files" };
  }
  const name = segments[segments.length - 1];
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.has(ext))
    return { ok: false, reason: `.${ext || "?"} files aren't editable` };
  return { ok: true, path };
}

/** Files that may hold credentials — never read, never sent to a model. */
const SECRET_FILES =
  /(^|\/)(\.env[^/]*|\.npmrc|\.yarnrc(\.yml)?|\.netrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519)[^/]*|[^/]*\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|kdbx)|credentials(\.json)?|service[-_]?account[^/]*\.json|secrets?\.(json|ya?ml|toml))$/i;
const SECRET_DIRS = /(^|\/)(\.git|\.ssh|\.aws|\.gnupg|secrets?|node_modules)(\/|$)/i;

/**
 * Validate a path Mellox wants to READ (agent investigation). Broader than
 * writes: configuration and manifests may be read to understand the site, but
 * credential files, git internals and dependency trees never are.
 */
export function checkReadPath(raw: string): PathCheck {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "Empty path" };
  const path = raw.trim().replace(/^\.\//, "");
  if (path.length > 300) return { ok: false, reason: "Path is too long" };
  if ([...path].some((ch) => ch.charCodeAt(0) < 32) || path.includes("\\"))
    return { ok: false, reason: "Path contains invalid characters" };
  if (path.startsWith("/") || /^[a-z]:/i.test(path))
    return { ok: false, reason: "Absolute paths aren't allowed" };
  if (path.split("/").some((s) => s === "" || s === "." || s === ".."))
    return { ok: false, reason: "Path traversal isn't allowed" };
  if (SECRET_DIRS.test(path)) return { ok: false, reason: "That directory is off-limits" };
  if (SECRET_FILES.test(path))
    return { ok: false, reason: "Files that may hold credentials are never read" };
  return { ok: true, path };
}

const BRANCH_RE = /^mellox\/geo-[a-z0-9][a-z0-9-]{0,48}-[a-z0-9]{6}$/;

/** Branch Mellox creates for a proposal: always under mellox/, never a base branch. */
export function proposalBranchName(fixId: string, suffix: string): string {
  const slug =
    fixId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "fix";
  const tail = suffix
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 6)
    .padEnd(6, "0");
  return `mellox/geo-${slug}-${tail}`;
}

export function isMelloxBranch(name: string): boolean {
  return BRANCH_RE.test(name);
}

/** A user-chosen base branch name (refs GitHub would accept, no traversal). */
export function isValidBaseBranch(name: string): boolean {
  return (
    /^[\w./-]{1,200}$/.test(name) &&
    !name.includes("..") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.endsWith(".lock") &&
    !name.startsWith("mellox/")
  );
}

/** `owner/repo` as GitHub returns it; guards URL building. */
export function isValidRepoFullName(name: string): boolean {
  return /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(name) && !name.includes("..");
}

/** Encode a repository path for the contents API, segment by segment. */
export function encodeRepoPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
