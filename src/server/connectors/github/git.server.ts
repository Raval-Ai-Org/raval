// git.server.ts — the repository operations behind AI Visibility fixes:
// read files, inspect branches, and open a pull request from a Mellox-owned
// branch. Every call goes through installationRequest (api.server.ts), so the
// installation token never leaves that module.
//
// Safety invariants, enforced here and not only by callers:
//   • writes only create refs under mellox/ — a base branch is never updated
//   • every written path passes checkRepoPath (no CI, config, lockfiles, env)
//   • file sizes are capped on read and write; binary files are refused
//   • nothing is merged: the result is always a reviewable pull request
import "server-only";
import { createHash } from "node:crypto";
import type { ChecksSummary } from "@/lib/geo/fix-contracts";
import { installationRequest, GitHubAccessError, GitHubRequestError } from "./api.server";
import {
  checkRepoPath,
  encodeRepoPath,
  isMelloxBranch,
  isValidRepoFullName,
  MAX_FILES_PER_CHANGE,
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
} from "./paths";

export class GitOperationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid"
      | "not_found"
      | "too_large"
      | "binary"
      | "branch_exists"
      | "base_moved"
      | "protected",
  ) {
    super(message);
    this.name = "GitOperationError";
  }
}

function repoPath(repo: string): string {
  if (!isValidRepoFullName(repo)) throw new GitOperationError("Invalid repository name", "invalid");
  return `/repos/${repo}`;
}

/* ───────────────────────── Branches & trees ───────────────────────── */

export type BranchInfo = { name: string; sha: string; treeSha: string; protected: boolean };

type BranchResponse = {
  name: string;
  protected?: boolean;
  commit: { sha: string; commit: { tree: { sha: string } } };
};

export async function getBranch(
  installationId: string,
  repo: string,
  branch: string,
): Promise<BranchInfo | null> {
  const json = await installationRequest<BranchResponse>(
    installationId,
    `${repoPath(repo)}/branches/${encodeURIComponent(branch)}`,
  );
  if (!json) return null;
  return {
    name: json.name,
    sha: json.commit.sha,
    treeSha: json.commit.commit.tree.sha,
    protected: json.protected === true,
  };
}

export async function listBranches(
  installationId: string,
  repo: string,
): Promise<{ name: string; protected: boolean }[]> {
  const out: { name: string; protected: boolean }[] = [];
  for (let page = 1; page <= 3; page++) {
    const json = await installationRequest<{ name: string; protected?: boolean }[]>(
      installationId,
      `${repoPath(repo)}/branches?per_page=100&page=${page}`,
      { notFoundIsAccessError: true },
    );
    const list = json ?? [];
    for (const b of list) {
      // Mellox's own proposal branches are never offered as a base.
      if (!b.name.startsWith("mellox/"))
        out.push({ name: b.name, protected: b.protected === true });
    }
    if (list.length < 100) break;
  }
  return out;
}

export async function getTreePaths(
  installationId: string,
  repo: string,
  treeSha: string,
): Promise<{ paths: string[]; truncated: boolean }> {
  const json = await installationRequest<{
    tree: { path: string; type: string; size?: number }[];
    truncated: boolean;
  }>(installationId, `${repoPath(repo)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`);
  const paths = (json?.tree ?? [])
    .filter((e) => e.type === "blob")
    .slice(0, 60_000)
    .map((e) => e.path);
  return { paths, truncated: Boolean(json?.truncated) };
}

/* ───────────────────────── Files ───────────────────────── */

export type RepoFile = { path: string; sha: string; content: string; size: number };

/** Decode UTF-8 strictly; a NUL byte or invalid sequence means "not a text file". */
export function decodeTextFile(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export async function readFile(
  installationId: string,
  repo: string,
  path: string,
  ref: string,
): Promise<RepoFile | null> {
  const json = await installationRequest<{
    type?: string;
    sha: string;
    size: number;
    content?: string;
    encoding?: string;
  }>(
    installationId,
    `${repoPath(repo)}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`,
  );
  if (!json) return null;
  if (json.type && json.type !== "file") {
    throw new GitOperationError(`${path} is not a file`, "invalid");
  }
  if (json.size > MAX_READ_BYTES) {
    throw new GitOperationError(
      `${path} is ${Math.round(json.size / 1024)} KB — too large for Mellox to edit safely`,
      "too_large",
    );
  }
  if (json.encoding !== "base64" || typeof json.content !== "string") {
    throw new GitOperationError(`${path} couldn't be read as a text file`, "binary");
  }
  const text = decodeTextFile(Buffer.from(json.content, "base64"));
  if (text === null) throw new GitOperationError(`${path} is not a UTF-8 text file`, "binary");
  return { path, sha: json.sha, content: text, size: json.size };
}

/* ───────────────────────── Writing a change ───────────────────────── */

export type FileWrite = { path: string; content: string };

export function contentHash(
  files: { path: string; action: string; after: string }[],
  baseSha: string,
) {
  const h = createHash("sha256");
  h.update(`base:${baseSha}\n`);
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    h.update(`${f.action}:${f.path}\n${f.after.length}\n${f.after}\n`);
  }
  return h.digest("hex");
}

/** Hard ceiling for one pull request, including a "Fix all" batch. */
export const MAX_FILES_PER_BATCH = 12;

function assertWritable(files: FileWrite[], headBranch: string, maxFiles: number) {
  if (!isMelloxBranch(headBranch)) {
    throw new GitOperationError("Mellox only writes to its own mellox/ branches", "invalid");
  }
  if (!files.length || files.length > maxFiles) {
    throw new GitOperationError(`A change must touch 1–${maxFiles} files`, "invalid");
  }
  const seen = new Set<string>();
  for (const f of files) {
    const check = checkRepoPath(f.path);
    if (!check.ok) throw new GitOperationError(`${f.path}: ${check.reason}`, "invalid");
    if (seen.has(check.path)) throw new GitOperationError(`${f.path} listed twice`, "invalid");
    seen.add(check.path);
    if (Buffer.byteLength(f.content, "utf8") > MAX_WRITE_BYTES) {
      throw new GitOperationError(`${f.path} would exceed the size limit`, "too_large");
    }
  }
}

/**
 * Commit `files` on top of `baseSha` and point a NEW branch `headBranch` at the
 * commit. The base branch is never touched; an existing head branch is refused.
 */
export async function commitToNewBranch(args: {
  installationId: string;
  repo: string;
  baseBranch: string;
  baseSha: string;
  headBranch: string;
  message: string;
  files: FileWrite[];
  /** Defaults to a single-finding change; a batch may pass up to MAX_FILES_PER_BATCH. */
  maxFiles?: number;
}): Promise<{ commitSha: string }> {
  const { installationId, repo } = args;
  assertWritable(
    args.files,
    args.headBranch,
    Math.min(args.maxFiles ?? MAX_FILES_PER_CHANGE, MAX_FILES_PER_BATCH),
  );

  const base = await getBranch(installationId, repo, args.baseBranch);
  if (!base)
    throw new GitOperationError(`Branch “${args.baseBranch}” no longer exists`, "not_found");
  if (base.sha !== args.baseSha) {
    throw new GitOperationError(
      `“${args.baseBranch}” changed since this proposal was generated. Regenerate it against the latest code.`,
      "base_moved",
    );
  }
  const existing = await getBranch(installationId, repo, args.headBranch);
  if (existing)
    throw new GitOperationError(`Branch ${args.headBranch} already exists`, "branch_exists");

  const tree = [];
  for (const f of args.files) {
    const blob = await installationRequest<{ sha: string }>(
      installationId,
      `${repoPath(repo)}/git/blobs`,
      {
        method: "POST",
        body: { content: Buffer.from(f.content, "utf8").toString("base64"), encoding: "base64" },
        notFoundIsAccessError: true,
      },
    );
    if (!blob) throw new GitOperationError("GitHub didn't store the file", "invalid");
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = await installationRequest<{ sha: string }>(
    installationId,
    `${repoPath(repo)}/git/trees`,
    {
      method: "POST",
      body: { base_tree: base.treeSha, tree },
      notFoundIsAccessError: true,
    },
  );
  if (!newTree) throw new GitOperationError("GitHub didn't create the tree", "invalid");
  const commit = await installationRequest<{ sha: string }>(
    installationId,
    `${repoPath(repo)}/git/commits`,
    {
      method: "POST",
      body: { message: args.message, tree: newTree.sha, parents: [base.sha] },
      notFoundIsAccessError: true,
    },
  );
  if (!commit) throw new GitOperationError("GitHub didn't create the commit", "invalid");
  try {
    await installationRequest(installationId, `${repoPath(repo)}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${args.headBranch}`, sha: commit.sha },
      notFoundIsAccessError: true,
    });
  } catch (error) {
    if (error instanceof GitHubRequestError && /exists/i.test(error.githubMessage)) {
      throw new GitOperationError(`Branch ${args.headBranch} already exists`, "branch_exists");
    }
    throw error;
  }
  return { commitSha: commit.sha };
}

/* ───────────────────────── Pull requests ───────────────────────── */

export type PullRequestInfo = {
  number: number;
  url: string;
  state: "open" | "closed" | "merged";
  mergedAt: string | null;
  headSha: string;
  headRef: string;
  baseRef: string;
  mergeable: boolean | null;
  draft: boolean;
};

type PullResponse = {
  number: number;
  html_url: string;
  state: "open" | "closed";
  merged?: boolean;
  merged_at: string | null;
  draft?: boolean;
  mergeable?: boolean | null;
  head: { sha: string; ref: string };
  base: { ref: string };
};

function toPullInfo(pr: PullResponse): PullRequestInfo {
  return {
    number: pr.number,
    url: /^https:\/\/github\.com\//.test(pr.html_url) ? pr.html_url : "",
    state: pr.merged || pr.merged_at ? "merged" : pr.state,
    mergedAt: pr.merged_at,
    headSha: pr.head.sha,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    mergeable: pr.mergeable ?? null,
    draft: pr.draft === true,
  };
}

export async function createPullRequest(args: {
  installationId: string;
  repo: string;
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
}): Promise<PullRequestInfo> {
  if (!isMelloxBranch(args.headBranch)) {
    throw new GitOperationError("Pull requests must come from a mellox/ branch", "invalid");
  }
  const pr = await installationRequest<PullResponse>(
    args.installationId,
    `${repoPath(args.repo)}/pulls`,
    {
      method: "POST",
      body: {
        title: args.title.slice(0, 250),
        body: args.body.slice(0, 60_000),
        head: args.headBranch,
        base: args.baseBranch,
        maintainer_can_modify: true,
      },
      notFoundIsAccessError: true,
    },
  );
  if (!pr) throw new GitOperationError("GitHub didn't open the pull request", "invalid");
  return toPullInfo(pr);
}

export async function getPullRequest(
  installationId: string,
  repo: string,
  number: number,
): Promise<PullRequestInfo | null> {
  const pr = await installationRequest<PullResponse>(
    installationId,
    `${repoPath(repo)}/pulls/${number}`,
  );
  return pr ? toPullInfo(pr) : null;
}

export async function closePullRequest(installationId: string, repo: string, number: number) {
  const pr = await installationRequest<PullResponse>(
    installationId,
    `${repoPath(repo)}/pulls/${number}`,
    {
      method: "PATCH",
      body: { state: "closed" },
      notFoundIsAccessError: true,
    },
  );
  return pr ? toPullInfo(pr) : null;
}

/** Delete a Mellox-created branch (never any other ref). */
export async function deleteMelloxBranch(installationId: string, repo: string, branch: string) {
  if (!isMelloxBranch(branch))
    throw new GitOperationError("Only mellox/ branches can be deleted", "invalid");
  await installationRequest(installationId, `${repoPath(repo)}/git/refs/heads/${branch}`, {
    method: "DELETE",
  });
}

/* ───────────────────────── CI checks ───────────────────────── */

/**
 * Commit statuses + check runs for a commit. Needs the App's "Checks: read"
 * and "Commit statuses: read" permissions; without them GitHub answers 403 and
 * the summary says so — it never guesses a result.
 */
export async function getChecks(
  installationId: string,
  repo: string,
  sha: string,
): Promise<ChecksSummary> {
  const checkedAt = new Date().toISOString();
  if (!/^[0-9a-f]{40}$/i.test(sha)) return { available: false, reason: "error", checkedAt };
  const runs: { name: string; status: string; conclusion: string | null; url: string | null }[] =
    [];
  let permissionDenied = 0;
  try {
    const json = await installationRequest<{
      check_runs: {
        name: string;
        status: string;
        conclusion: string | null;
        html_url: string | null;
      }[];
    }>(installationId, `${repoPath(repo)}/commits/${sha}/check-runs?per_page=50`);
    for (const r of json?.check_runs ?? []) {
      runs.push({ name: r.name, status: r.status, conclusion: r.conclusion, url: r.html_url });
    }
  } catch (error) {
    if (!(error instanceof GitHubAccessError))
      return { available: false, reason: "error", checkedAt };
    permissionDenied++;
  }
  try {
    const json = await installationRequest<{
      statuses: { context: string; state: string; target_url: string | null }[];
    }>(installationId, `${repoPath(repo)}/commits/${sha}/status`);
    for (const s of json?.statuses ?? []) {
      runs.push({
        name: s.context,
        status: s.state === "pending" ? "in_progress" : "completed",
        conclusion: s.state === "pending" ? null : s.state === "success" ? "success" : "failure",
        url: s.target_url,
      });
    }
  } catch (error) {
    if (!(error instanceof GitHubAccessError))
      return { available: false, reason: "error", checkedAt };
    permissionDenied++;
  }
  if (permissionDenied === 2) return { available: false, reason: "permission", checkedAt };

  const passed = runs.filter(
    (r) =>
      r.status === "completed" && ["success", "neutral", "skipped"].includes(r.conclusion ?? ""),
  ).length;
  const pending = runs.filter((r) => r.status !== "completed").length;
  const failed = runs.length - passed - pending;
  return {
    available: true,
    checkedAt,
    state: !runs.length ? "none" : failed ? "failure" : pending ? "pending" : "success",
    total: runs.length,
    passed,
    failed,
    pending,
    runs: runs.slice(0, 30).map((r) => ({
      ...r,
      url: r.url && /^https:\/\//.test(r.url) ? r.url : null,
    })),
  };
}
