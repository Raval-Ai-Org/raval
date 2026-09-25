// live-check.server.ts — only the live check starts the clock (ADR-0024 §5
// steps 6 and 8, §7). Pages are fetched as raw HTML through safeFetch:
//
//   ship      every sampled treatment page shows its new value and every
//             sampled control page still shows its recorded value → running
//   rollout   sampled pages of both arms show the rolled-out values → closed
//   rollback  sampled treatment pages show their original values → closed
//   contamination (weekly, while running) a control page that no longer shows
//             its recorded value invalidates the test; a page that 404s is
//             excluded together with its pair partner
//
// Unreadable pages (bot walls, errors) never count as proof either way.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CONTAMINATION_INTERVAL_DAYS,
  LIVE_CHECK_INTERVAL_MINUTES,
  LIVE_CHECK_MAX_DAYS,
  LIVE_CHECK_SAMPLE,
  type ChangeType,
} from "@/lib/experiments/constants";
import { parseFieldValue, type FieldValue } from "@/lib/experiments/datafile";
import { showsValue, unchangedFrom } from "@/lib/experiments/fields";
import { mulberry32 } from "@/lib/experiments/random";
import {
  enqueueJob,
  patchExperiment,
  recordEvent,
  transition,
  type AssignmentRow,
  type ChangeRow,
  type DeliveryRow,
  type ExperimentRow,
} from "./core.server";
import { fetchPages } from "./pages.server";

export type LiveOutcome = "confirmed" | "waiting" | "gave_up";

function sample<T>(items: T[], n: number, seed: number): T[] {
  const rng = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export async function loadDesign(experimentId: string) {
  const [assignments, changes] = await Promise.all([
    supabaseAdmin.from("experiment_assignments").select("*").eq("experiment_id", experimentId),
    supabaseAdmin.from("experiment_changes").select("*").eq("experiment_id", experimentId),
  ]);
  if (assignments.error) throw new Error(assignments.error.message);
  if (changes.error) throw new Error(changes.error.message);
  return {
    assignments: (assignments.data ?? []) as AssignmentRow[],
    changes: (changes.data ?? []) as ChangeRow[],
  };
}

function baselineValue(a: AssignmentRow): string | null {
  const b = (a.baseline ?? {}) as { fieldValue?: string | null };
  return typeof b.fieldValue === "string" ? b.fieldValue : null;
}

async function latestDelivery(experimentId: string, kind: DeliveryRow["kind"]) {
  const { data } = await supabaseAdmin
    .from("experiment_deliveries")
    .select("*")
    .eq("experiment_id", experimentId)
    .eq("kind", kind)
    .in("status", ["merged", "live"])
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as DeliveryRow | undefined) ?? null;
}

/** Values the rollout delivery wrote, from its data file. */
function rolloutValues(delivery: DeliveryRow, experimentId: string): Map<string, FieldValue> {
  const files = (delivery.files ?? []) as { after?: string }[];
  const out = new Map<string, FieldValue>();
  try {
    const parsed = JSON.parse(files[0]?.after ?? "{}") as {
      experiments?: Record<string, { pages?: Record<string, FieldValue> }>;
    };
    for (const [path, value] of Object.entries(parsed.experiments?.[experimentId]?.pages ?? {})) {
      out.set(path, value);
    }
  } catch {
    // an unreadable delivery proves nothing
  }
  return out;
}

async function giveUpOrWait(
  experiment: ExperimentRow,
  delivery: DeliveryRow,
  reason: string,
): Promise<LiveOutcome> {
  const since = Date.parse(delivery.merged_at ?? delivery.updated_at);
  if (Date.now() - since > LIVE_CHECK_MAX_DAYS * 86_400_000) {
    await recordEvent(
      experiment,
      "live_check_gave_up",
      `The change still isn't visible on the site ${LIVE_CHECK_MAX_DAYS} days after the merge. ${reason}`,
    );
    await patchExperiment(experiment.id, {
      result: {
        ...((experiment.result ?? {}) as object),
        liveCheck: { ok: false, reason, at: new Date().toISOString() },
      },
    });
    return "gave_up";
  }
  await patchExperiment(experiment.id, {
    result: {
      ...((experiment.result ?? {}) as object),
      liveCheck: { ok: false, reason, at: new Date().toISOString() },
    },
  });
  // The runner re-queues this job LIVE_CHECK_INTERVAL_MINUTES later.
  return "waiting";
}

export const LIVE_RETRY_MS = LIVE_CHECK_INTERVAL_MINUTES * 60_000;

export async function checkLive(experiment: ExperimentRow): Promise<LiveOutcome> {
  const origin = `https://${experiment.site_host}`;
  const field = experiment.change_type as ChangeType;
  const { assignments, changes } = await loadDesign(experiment.id);
  const active = assignments.filter((a) => !a.excluded_at);
  const after = new Map(changes.map((c) => [c.path, parseFieldValue(field, c.after)]));
  const seed = Date.now() & 0x7fffffff;

  if (experiment.status === "awaiting_deploy") {
    const delivery = await latestDelivery(experiment.id, "ship");
    if (!delivery) return "waiting";
    const treatment = sample(
      active.filter((a) => a.arm === "treatment"),
      LIVE_CHECK_SAMPLE,
      seed,
    );
    const control = sample(
      active.filter((a) => a.arm === "control"),
      LIVE_CHECK_SAMPLE,
      seed + 1,
    );
    const pages = await fetchPages(
      origin,
      [...treatment, ...control].map((a) => a.path),
    );
    for (const a of treatment) {
      const page = pages.get(a.path)!;
      const value = after.get(a.path);
      if (!page.fields)
        return giveUpOrWait(experiment, delivery, `${a.path}: ${page.problem ?? "unreadable"}`);
      if (!value || !showsValue(page.fields, field, value)) {
        return giveUpOrWait(experiment, delivery, `${a.path} doesn't show the new value yet.`);
      }
    }
    for (const a of control) {
      const page = pages.get(a.path)!;
      if (!page.fields)
        return giveUpOrWait(experiment, delivery, `${a.path}: ${page.problem ?? "unreadable"}`);
      if (unchangedFrom(page.fields, field, baselineValue(a)) === false) {
        return giveUpOrWait(experiment, delivery, `Control page ${a.path} changed too.`);
      }
    }
    const now = new Date();
    const moved = await transition(
      experiment,
      "awaiting_deploy",
      "running",
      {
        live_confirmed_at: now.toISOString(),
        result: {
          ...((experiment.result ?? {}) as object),
          liveCheck: {
            ok: true,
            at: now.toISOString(),
            sampled: treatment.length + control.length,
          },
        },
      },
      {
        kind: "live_confirmed",
        summary: `The change is live: ${treatment.length} test pages show it and ${control.length} comparison pages don't. Day 0 starts now.`,
      },
    );
    if (!moved) return "waiting";
    await supabaseAdmin
      .from("experiment_deliveries")
      .update({ status: "live", live_at: now.toISOString() })
      .eq("id", delivery.id);
    await enqueueJob(experiment, "pull_metrics", new Date(now.getTime() + 60_000));
    await enqueueJob(
      experiment,
      "check_contamination",
      new Date(now.getTime() + CONTAMINATION_INTERVAL_DAYS * 86_400_000),
    );
    return "confirmed";
  }

  if (experiment.status === "rolling_out" || experiment.status === "rolling_back") {
    const kind = experiment.status === "rolling_out" ? "rollout" : "rollback";
    const delivery = await latestDelivery(experiment.id, kind);
    if (!delivery) return "waiting";
    if (kind === "rollout") {
      const values = rolloutValues(delivery, experiment.id);
      const targets = sample(
        active.filter((a) => values.has(a.path)),
        LIVE_CHECK_SAMPLE,
        seed,
      );
      const pages = await fetchPages(
        origin,
        targets.map((a) => a.path),
      );
      for (const a of targets) {
        const page = pages.get(a.path)!;
        if (!page.fields)
          return giveUpOrWait(experiment, delivery, `${a.path}: ${page.problem ?? "unreadable"}`);
        if (!showsValue(page.fields, field, values.get(a.path)!)) {
          return giveUpOrWait(
            experiment,
            delivery,
            `${a.path} doesn't show the rolled-out value yet.`,
          );
        }
      }
    } else {
      const targets = sample(
        active.filter((a) => a.arm === "treatment"),
        LIVE_CHECK_SAMPLE,
        seed,
      );
      const pages = await fetchPages(
        origin,
        targets.map((a) => a.path),
      );
      for (const a of targets) {
        const page = pages.get(a.path)!;
        if (!page.fields)
          return giveUpOrWait(experiment, delivery, `${a.path}: ${page.problem ?? "unreadable"}`);
        const value = after.get(a.path);
        if (value && showsValue(page.fields, field, value)) {
          return giveUpOrWait(experiment, delivery, `${a.path} still shows the test value.`);
        }
      }
    }
    const now = new Date().toISOString();
    const moved = await transition(
      experiment,
      experiment.status,
      "closed",
      { closed_at: now, closed_via: kind },
      {
        kind: "closed",
        summary:
          kind === "rollout"
            ? "The winning change is live on every page in the group. Experiment closed."
            : "The test change was removed from the site. Experiment closed.",
      },
    );
    if (moved) {
      await supabaseAdmin
        .from("experiment_deliveries")
        .update({ status: "live", live_at: now })
        .eq("id", delivery.id);
    }
    return moved ? "confirmed" : "waiting";
  }
  return "waiting";
}

/** Weekly while running: control pages unchanged; 404s excluded with their pair. */
export const CONTAMINATION_RETRY_MS = CONTAMINATION_INTERVAL_DAYS * 86_400_000;

export async function checkContamination(
  experiment: ExperimentRow,
): Promise<{ contaminated: boolean; excluded: number }> {
  const origin = `https://${experiment.site_host}`;
  const field = experiment.change_type as ChangeType;
  const { assignments } = await loadDesign(experiment.id);
  const active = assignments.filter((a) => !a.excluded_at);
  const seed = (Date.now() >>> 3) & 0x7fffffff;
  const control = sample(
    active.filter((a) => a.arm === "control"),
    LIVE_CHECK_SAMPLE,
    seed,
  );
  const treatment = sample(
    active.filter((a) => a.arm === "treatment"),
    LIVE_CHECK_SAMPLE,
    seed + 7,
  );
  const pages = await fetchPages(
    origin,
    [...control, ...treatment].map((a) => a.path),
  );

  let excluded = 0;
  for (const a of [...control, ...treatment]) {
    const page = pages.get(a.path)!;
    if (page.status === 404 || page.status === 410) {
      const partners = active.filter((p) => p.stratum === a.stratum);
      const now = new Date().toISOString();
      await supabaseAdmin
        .from("experiment_assignments")
        .update({ excluded_at: now, excluded_reason: `The page returned ${page.status}.` })
        .in(
          "id",
          partners.map((p) => p.id),
        )
        .is("excluded_at", null);
      await recordEvent(
        experiment,
        "page_excluded",
        `${a.path} returned ${page.status}; it and its paired page are left out of the analysis.`,
      );
      excluded++;
    }
  }
  for (const a of control) {
    const page = pages.get(a.path)!;
    if (!page.fields) continue;
    if (unchangedFrom(page.fields, field, baselineValue(a)) === false) {
      const reason = `Control page ${a.path} changed during the test, so the comparison is no longer fair.`;
      await transition(
        experiment,
        ["running", "analyzing"],
        "invalidated",
        { invalidated_at: new Date().toISOString(), invalid_reason: reason },
        { kind: "invalidated", summary: reason },
      );
      return { contaminated: true, excluded };
    }
  }
  return { contaminated: false, excluded };
}
