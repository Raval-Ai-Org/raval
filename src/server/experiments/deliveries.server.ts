// deliveries.server.ts — every change Mellox proposes to a repository for the
// Proof Engine is a delivery: integration, ship, rollout or rollback.
//
//   build      ship / rollout / rollback rewrite mellox-experiments/overrides.json
//              deterministically from approved values (datafile.ts)
//   approve    exact-content approval: the content hash the person reviewed,
//              compare-and-set draft → applying, ownership re-checked, then a
//              new mellox/exp-… branch and a pull request. Never a merge.
//   sync       pull request state (webhook + cron); a merge moves the
//              experiment on, a close without merge cancels or reverts it
//
// Only one experiment pull request may be open per repository at a time: the
// data file is shared, and two open PRs editing it would conflict.
import "server-only";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { DATA_FILE_DIR, type ChangeType } from "@/lib/experiments/constants";
import {
  conflictingPaths,
  OVERRIDES_FILE,
  parseOverrides,
  serializeOverrides,
  withEntry,
  type ExperimentEntry,
} from "@/lib/experiments/datafile";
import { recordAudit } from "@/server/audit.server";
import { GitHubAccessError } from "@/server/connectors/github/api.server";
import {
  closePullRequest,
  commitToNewBranch,
  contentHash,
  createPullRequest,
  deleteMelloxBranch,
  getBranch,
  getPullRequest,
  GitOperationError,
  MAX_FILES_PER_BATCH,
  readFile,
} from "@/server/connectors/github/git.server";
import { experimentBranchName } from "@/server/connectors/github/paths";
import { withAccess } from "@/server/connectors/github/service.server";
import { describeGitError } from "@/server/geo/fixes/service.server";
import type { ProposedFile } from "@/server/geo/fixes/validate";
import {
  ExperimentError,
  enqueueJob,
  loadExperimentAdmin,
  recordEvent,
  transition,
  type DeliveryRow,
  type ExperimentCtx,
  type ExperimentRow,
} from "./core.server";
import { verifyIntegrationOnBase } from "./integration.server";
import { loadSiteSources, requireWritableSource } from "./sources.server";

const OPEN = ["draft", "applying", "pr_open"];

export function storedFiles(row: Pick<DeliveryRow, "files">): ProposedFile[] {
  return (Array.isArray(row.files) ? row.files : []) as unknown as ProposedFile[];
}

/** Where the data file lives, from the repository's live integration. */
export async function dataFileFor(sourceId: string, templateFile: string | null) {
  const { data } = await supabaseAdmin
    .from("experiment_deliveries")
    .select("validation, template_files, fields")
    .eq("source_id", sourceId)
    .eq("kind", "integration")
    .eq("status", "live")
    .order("created_at", { ascending: false });
  const rows = data ?? [];
  const match =
    rows.find((r) => templateFile && (r.template_files ?? []).includes(templateFile)) ?? null;
  if (!match) return null;
  const v = (match.validation ?? {}) as { dataFile?: string };
  return v.dataFile ? { dataFile: v.dataFile, fields: (match.fields ?? []) as ChangeType[] } : null;
}

async function assertNoOtherOpenPr(sourceId: string, exceptExperiment: string | null) {
  const { data } = await supabaseAdmin
    .from("experiment_deliveries")
    .select("id, experiment_id, kind, status")
    .eq("source_id", sourceId)
    .in("status", ["applying", "pr_open"]);
  const other = (data ?? []).find(
    (d) => d.experiment_id !== exceptExperiment || d.kind === "integration",
  );
  if (other) {
    throw new ExperimentError(
      "Another Mellox experiment pull request is open in this repository. Merge or close it first.",
      409,
    );
  }
}

/* ───────────────────────── build ───────────────────────── */

/**
 * Draft a delivery that sets (or removes) this experiment's entry in the
 * data file, against the current base branch. Replaces an older draft.
 */
export async function buildDataFileDelivery(args: {
  experiment: ExperimentRow;
  kind: "ship" | "rollout" | "rollback";
  entry: ExperimentEntry | null;
  templateFile: string | null;
  userId: string | null;
}): Promise<DeliveryRow> {
  const { experiment, kind } = args;
  const sources = await loadSiteSources(experiment.workspace_id);
  const { source, connection, baseBranch } = requireWritableSource(sources);
  if (experiment.source_id && experiment.source_id !== source.id) {
    throw new ExperimentError("The experiment's repository was changed or disconnected.", 409);
  }
  const target = await dataFileFor(source.id, args.templateFile);
  if (!target)
    throw new ExperimentError("These pages haven't been set up for experiments yet.", 409);

  const installationId = connection.external_account_id;
  const base = await withAccess(connection, args.userId, () =>
    getBranch(installationId, source.full_name, baseBranch),
  );
  if (!base) throw new ExperimentError(`Branch “${baseBranch}” wasn't found.`, 409);
  const current = await withAccess(connection, args.userId, () =>
    readFile(installationId, source.full_name, target.dataFile, base.sha),
  );
  if (!current) throw new ExperimentError(`${target.dataFile} is missing from ${baseBranch}.`, 409);
  const parsed = parseOverrides(current.content);
  if (!parsed.ok) throw new ExperimentError(parsed.reason, 409);

  const problems: string[] = [];
  if (args.entry) {
    const clash = conflictingPaths(parsed.file, experiment.id, args.entry);
    if (clash.length) {
      problems.push(
        `${clash.length} page(s) already carry a ${args.entry.field} value from another experiment (${clash.slice(0, 3).join(", ")}).`,
      );
    }
  }
  const next = serializeOverrides(withEntry(parsed.file, experiment.id, args.entry));
  if (next === current.content) {
    problems.push("The data file on the main branch already has this content.");
  }
  const files: ProposedFile[] = [
    { path: target.dataFile, action: "update", before: current.content, after: next },
  ];
  const hash = contentHash(files, base.sha);

  // One draft per experiment and kind: replace an older, unapproved one.
  await supabaseAdmin
    .from("experiment_deliveries")
    .update({ status: "discarded" })
    .eq("experiment_id", experiment.id)
    .eq("kind", kind)
    .in("status", ["draft"]);
  const { data, error } = await supabaseAdmin
    .from("experiment_deliveries")
    .insert({
      workspace_id: experiment.workspace_id,
      source_id: source.id,
      experiment_id: experiment.id,
      kind,
      status: "draft",
      files: files as unknown as Json,
      content_hash: hash,
      validation: { ok: problems.length === 0, problems, dataFile: target.dataFile } as Json,
      base_branch: baseBranch,
      base_sha: base.sha,
      template_files: args.templateFile ? [args.templateFile] : [],
      fields: args.entry ? [args.entry.field] : [],
      created_by: args.userId,
    })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      throw new ExperimentError("A pull request for this step is already in progress.", 409);
    }
    throw new Error(error.message);
  }
  return data as DeliveryRow;
}

/* ───────────────────────── approve & apply ───────────────────────── */

function prText(delivery: DeliveryRow, experiment: ExperimentRow | null) {
  const what: Record<DeliveryRow["kind"], string> = {
    integration: "Set up Mellox experiments for these pages",
    ship: "Start experiment",
    rollout: "Roll out winning change",
    rollback: "Roll back experiment change",
  };
  const title = `Mellox: ${what[delivery.kind]}${experiment ? ` — ${experiment.name}` : ""}`.slice(
    0,
    200,
  );
  const lines = [
    `This pull request was prepared by Mellox Proof Engine and approved in Mellox.`,
    "",
  ];
  if (delivery.kind === "integration") {
    lines.push(
      "It adds a small reader module and an empty data file, and lets the page template use a value from that file when one exists. Until an experiment is approved the file is empty, so nothing on the site changes.",
    );
  } else if (experiment) {
    lines.push(
      `**Experiment:** ${experiment.name}`,
      `**Hypothesis:** ${experiment.hypothesis}`,
      "",
    );
    lines.push(
      delivery.kind === "ship"
        ? "Merging this changes the listed field on the test pages only. The other half of the group stays as it is, so the two halves can be compared."
        : delivery.kind === "rollout"
          ? "Merging this applies the winning change to every page in the group."
          : "Merging this removes the experiment's values, so the pages go back to their original text.",
    );
  }
  lines.push(
    "",
    `Only \`${DATA_FILE_DIR}/${OVERRIDES_FILE}\` and the listed files change. Mellox never merges; review and merge it yourself.`,
  );
  return { title, body: lines.join("\n") };
}

/**
 * Exact-content approval for any delivery. Callers handle experiment status
 * before (e.g. draft → awaiting_approval) and pass `onOpened`/`onFailed`.
 */
export async function approveAndOpen(
  ctx: ExperimentCtx,
  deliveryId: string,
  hash: string,
): Promise<DeliveryRow> {
  const { data: row, error } = await ctx.supabase
    .from("experiment_deliveries")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", deliveryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new ExperimentError("Pull request draft not found", 404);
  const delivery = row as DeliveryRow;
  if (delivery.status !== "draft")
    throw new ExperimentError("This change is no longer waiting for approval.", 409);
  const v = (delivery.validation ?? {}) as { ok?: boolean; problems?: string[] };
  if (!v.ok) {
    throw new ExperimentError(
      v.problems?.[0] ?? "This change failed its checks and can't be applied.",
      409,
    );
  }
  if (!delivery.content_hash || delivery.content_hash !== hash) {
    throw new ExperimentError(
      "The change was updated since you reviewed it. Review it again.",
      409,
    );
  }
  const files = storedFiles(delivery);
  const sources = await loadSiteSources(ctx.workspaceId);
  const { source, connection } = requireWritableSource(sources);
  if (delivery.source_id !== source.id) {
    throw new ExperimentError("The repository changed. Prepare this change again.", 409);
  }
  await assertNoOtherOpenPr(source.id, delivery.experiment_id);

  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("experiment_deliveries")
    .update({
      status: "applying",
      approved_by: ctx.userId,
      approved_at: new Date().toISOString(),
      error: null,
    })
    .eq("id", delivery.id)
    .eq("status", "draft")
    .eq("content_hash", hash)
    .select("id");
  if (claimError) throw new Error(claimError.message);
  if (!claimed?.length) throw new ExperimentError("This change is already being applied.", 409);

  const experiment = delivery.experiment_id
    ? await loadExperimentAdmin(delivery.experiment_id)
    : null;
  await recordAudit({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    action: `experiment.${delivery.kind}.approved`,
    entity: "experiment_delivery",
    payload: {
      deliveryId: delivery.id,
      experimentId: delivery.experiment_id,
      repository: source.full_name,
      contentHash: hash,
    },
  });

  const installationId = connection.external_account_id;
  const headBranch = experimentBranchName(
    delivery.kind,
    (delivery.experiment_id ?? delivery.id).slice(0, 8),
    randomBytes(4).toString("hex"),
  );
  const { title, body } = prText(delivery, experiment);
  let branchCreated = false;
  try {
    const { commitSha } = await withAccess(connection, ctx.userId, () =>
      commitToNewBranch({
        installationId,
        repo: source.full_name,
        baseBranch: delivery.base_branch!,
        baseSha: delivery.base_sha!,
        headBranch,
        message: `${title}\n\nPrepared by Mellox Proof Engine and approved in Mellox.`,
        files: files.map((f) => ({ path: f.path, content: f.after })),
        maxFiles: MAX_FILES_PER_BATCH,
      }),
    );
    branchCreated = true;
    const pr = await withAccess(connection, ctx.userId, () =>
      createPullRequest({
        installationId,
        repo: source.full_name,
        headBranch,
        baseBranch: delivery.base_branch!,
        title,
        body,
      }),
    );
    const { data: updated, error: upError } = await supabaseAdmin
      .from("experiment_deliveries")
      .update({
        status: "pr_open",
        head_branch: headBranch,
        commit_sha: commitSha,
        pr_number: pr.number,
        pr_url: pr.url,
        pr_state: pr.state,
      })
      .eq("id", delivery.id)
      .select("*")
      .single();
    if (upError) throw new Error(upError.message);
    await recordAudit({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      action: `experiment.${delivery.kind}.pr_opened`,
      entity: "experiment_delivery",
      payload: {
        deliveryId: delivery.id,
        repository: source.full_name,
        pr: pr.number,
        branch: headBranch,
      },
    });
    if (experiment) {
      await recordEvent(
        experiment,
        "pr_opened",
        `Pull request #${pr.number} opened (${delivery.kind}).`,
        { pr: pr.number, url: pr.url, kind: delivery.kind },
        ctx.userId,
      );
    }
    return updated as DeliveryRow;
  } catch (error) {
    const message = describeGitError(error);
    const stale = error instanceof GitOperationError && error.code === "base_moved";
    const accessLost = error instanceof GitHubAccessError && error.reason !== "forbidden";
    if (branchCreated) {
      await deleteMelloxBranch(installationId, source.full_name, headBranch).catch(() => {});
    }
    await supabaseAdmin
      .from("experiment_deliveries")
      .update({
        status: stale ? "stale" : accessLost ? "access_lost" : "failed",
        error: message.slice(0, 500),
      })
      .eq("id", delivery.id);
    if (experiment)
      await recordEvent(
        experiment,
        "pr_failed",
        `Couldn't open the pull request: ${message}`.slice(0, 500),
      );
    throw new ExperimentError(
      stale ? "The main branch changed since this was prepared. Prepare it again." : message,
      stale ? 409 : 502,
    );
  }
}

export async function discardDraftDelivery(ctx: ExperimentCtx, deliveryId: string) {
  const { data, error } = await ctx.supabase
    .from("experiment_deliveries")
    .select("id, status")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", deliveryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ExperimentError("Not found", 404);
  if (!["draft", "stale", "failed", "access_lost"].includes(data.status)) {
    throw new ExperimentError("Only an unapproved change can be discarded.", 409);
  }
  await supabaseAdmin
    .from("experiment_deliveries")
    .update({ status: "discarded" })
    .eq("id", deliveryId);
}

/** Close Mellox's open pull request (and delete its branch). */
export async function closeOpenPr(delivery: DeliveryRow, userId: string | null) {
  if (delivery.status !== "pr_open" || !delivery.pr_number) return;
  const sources = await loadSiteSources(delivery.workspace_id);
  if (!sources.source || !sources.connection || sources.source.id !== delivery.source_id) return;
  const installationId = sources.connection.external_account_id;
  const repo = sources.source.full_name;
  await withAccess(sources.connection, userId, () =>
    closePullRequest(installationId, repo, delivery.pr_number!),
  ).catch(() => null);
  if (delivery.head_branch) {
    await deleteMelloxBranch(installationId, repo, delivery.head_branch).catch(() => {});
  }
  await supabaseAdmin
    .from("experiment_deliveries")
    .update({ status: "closed", pr_state: "closed" })
    .eq("id", delivery.id);
}

/* ───────────────────────── sync ───────────────────────── */

async function onMerged(delivery: DeliveryRow) {
  if (delivery.kind === "integration") {
    const check = await verifyIntegrationOnBase(delivery);
    await supabaseAdmin
      .from("experiment_deliveries")
      .update(
        check.ok
          ? { status: "live", live_at: new Date().toISOString(), error: null }
          : { error: check.reason?.slice(0, 500) ?? null },
      )
      .eq("id", delivery.id);
    return;
  }
  const experiment = delivery.experiment_id
    ? await loadExperimentAdmin(delivery.experiment_id)
    : null;
  if (!experiment) return;
  await recordEvent(
    experiment,
    "pr_merged",
    `Pull request #${delivery.pr_number} was merged (${delivery.kind}).`,
    { kind: delivery.kind },
  );
  // The live check starts the clock (ship) or closes the experiment (rollout/rollback).
  await enqueueJob(experiment, "check_live", new Date(), { deliveryId: delivery.id });
}

async function onClosedUnmerged(delivery: DeliveryRow) {
  if (delivery.kind === "integration") return;
  const experiment = delivery.experiment_id
    ? await loadExperimentAdmin(delivery.experiment_id)
    : null;
  if (!experiment) return;
  if (delivery.kind === "ship") {
    await transition(
      experiment,
      ["awaiting_deploy", "shipping"],
      "cancelled",
      { cancelled_at: new Date().toISOString() },
      {
        kind: "cancelled",
        summary: `Pull request #${delivery.pr_number} was closed without merging, so the experiment was cancelled.`,
      },
    );
  } else {
    const from = delivery.kind === "rollout" ? "rolling_out" : "rolling_back";
    await transition(
      experiment,
      from,
      // A stopped test has no result to go back to.
      experiment.verdict ? "concluded" : "invalidated",
      {},
      {
        kind: "pr_closed",
        summary: `Pull request #${delivery.pr_number} was closed without merging. Nothing changed on the site.`,
      },
    );
  }
}

/** Apply a pull request's state to its delivery (webhook or poll). */
export async function applyPrState(
  delivery: DeliveryRow,
  pr: { state: "open" | "closed" | "merged"; mergedAt: string | null },
) {
  if (pr.state === "merged" && delivery.status === "pr_open") {
    const { data } = await supabaseAdmin
      .from("experiment_deliveries")
      .update({
        status: "merged",
        pr_state: "merged",
        merged_at: pr.mergedAt ?? new Date().toISOString(),
      })
      .eq("id", delivery.id)
      .eq("status", "pr_open")
      .select("*");
    if (data?.length) await onMerged(data[0] as DeliveryRow);
  } else if (pr.state === "closed" && delivery.status === "pr_open") {
    const { data } = await supabaseAdmin
      .from("experiment_deliveries")
      .update({ status: "closed", pr_state: "closed" })
      .eq("id", delivery.id)
      .eq("status", "pr_open")
      .select("*");
    if (data?.length) await onClosedUnmerged(data[0] as DeliveryRow);
  } else if (delivery.status === "merged" && delivery.kind === "integration") {
    await onMerged(delivery);
  }
}

export async function syncDelivery(delivery: DeliveryRow) {
  if (!delivery.pr_number || !delivery.source_id) return;
  const sources = await loadSiteSources(delivery.workspace_id);
  if (!sources.source || !sources.connection || sources.source.id !== delivery.source_id) return;
  const pr = await getPullRequest(
    sources.connection.external_account_id,
    sources.source.full_name,
    delivery.pr_number,
  ).catch(() => null);
  await supabaseAdmin
    .from("experiment_deliveries")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", delivery.id);
  if (pr) await applyPrState(delivery, pr);
}

/** Cron: open pull requests not synced for five minutes (webhooks may not arrive). */
export async function syncOpenDeliveries(max = 8) {
  const { data, error } = await supabaseAdmin
    .from("experiment_deliveries")
    .select("*")
    .or("status.eq.pr_open,and(kind.eq.integration,status.eq.merged)")
    .lt("updated_at", new Date(Date.now() - 5 * 60_000).toISOString())
    .order("updated_at", { ascending: true })
    .limit(max);
  if (error) throw new Error(error.message);
  let n = 0;
  for (const row of (data ?? []) as DeliveryRow[]) {
    try {
      await syncDelivery(row);
      n++;
    } catch (e) {
      console.error(
        "[experiments] delivery sync failed",
        row.id,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return n;
}

/** GitHub webhook: a pull request on a mellox/exp- branch changed. */
export async function handleExperimentPullRequest(
  connectionIds: string[],
  pr: {
    repositoryId: string;
    number: number;
    state: "open" | "closed" | "merged";
    mergedAt: string | null;
    headRef: string;
  },
): Promise<number> {
  if (!connectionIds.length || !pr.headRef.startsWith("mellox/exp-")) return 0;
  const { data: sources } = await supabaseAdmin
    .from("workspace_sources")
    .select("id")
    .in("connection_id", connectionIds)
    .eq("external_id", pr.repositoryId);
  const ids = (sources ?? []).map((s) => s.id);
  if (!ids.length) return 0;
  const { data } = await supabaseAdmin
    .from("experiment_deliveries")
    .select("*")
    .in("source_id", ids)
    .eq("pr_number", pr.number)
    .eq("head_branch", pr.headRef);
  for (const row of (data ?? []) as DeliveryRow[]) await applyPrState(row, pr);
  return data?.length ?? 0;
}

export { OPEN as OPEN_DELIVERY_STATUSES };
